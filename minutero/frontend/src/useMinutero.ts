import { useCallback, useEffect, useRef, useState } from 'react'

type ChatRole = 'user' | 'assistant'
export type ChatMessage = { role: ChatRole; content: string }
export type ChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  transcript: string
  messages: ChatMessage[]
}
export type ImportantDate = {
  id: string
  day: string
  num: string
  title: string
  desc: string
}

const MONTHS = [
  { name: 'enero', short: 'ENE', index: 0 },
  { name: 'febrero', short: 'FEB', index: 1 },
  { name: 'marzo', short: 'MAR', index: 2 },
  { name: 'abril', short: 'ABR', index: 3 },
  { name: 'mayo', short: 'MAY', index: 4 },
  { name: 'junio', short: 'JUN', index: 5 },
  { name: 'julio', short: 'JUL', index: 6 },
  { name: 'agosto', short: 'AGO', index: 7 },
  { name: 'septiembre', short: 'SEP', index: 8 },
  { name: 'setiembre', short: 'SEP', index: 8 },
  { name: 'octubre', short: 'OCT', index: 9 },
  { name: 'noviembre', short: 'NOV', index: 10 },
  { name: 'diciembre', short: 'DIC', index: 11 },
]

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
}

const IMPORTANT_DATES_STORAGE_KEY = 'minutero-important-dates'
const CHAT_SESSIONS_STORAGE_KEY = 'minutero-chat-sessions'
const MICROPHONE_STORAGE_KEY = 'minutero-microphone-device-id'
const TTS_RATE_STORAGE_KEY = 'minutero-tts-rate'
const TTS_VOICE_STORAGE_KEY = 'minutero-tts-voice-uri'
const EASY_READ_STORAGE_KEY = 'minutero-easy-read'
const BARGE_IN_STORAGE_KEY = 'minutero-barge-in'

// Umbral RMS para considerar que el usuario empezo a hablar durante una
// respuesta hablada. Mas alto que el del listening normal (0.018) para evitar
// que el propio audio de TTS al salir por bocinas dispare un falso positivo.
const BARGE_IN_RMS_THRESHOLD = 0.04
const BARGE_IN_HITS_REQUIRED = 4

// Etiquetas tipicas de dispositivos que dependen de red (Continuity Camera de
// iPhone/iPad). Los marcamos para preferir explicitamente el micro fisico del
// Mac y avisar al usuario que la opcion seleccionada necesita Wi-Fi/Bluetooth.
const NETWORK_MIC_HINTS = [
  'iphone',
  'ipad',
  'continuity',
  'continuidad',
  'airpods', // tambien usan Bluetooth
]

function isNetworkDependentMic(label: string) {
  const normalized = label.toLowerCase()
  return NETWORK_MIC_HINTS.some((hint) => normalized.includes(hint))
}
const DEFAULT_TRANSCRIPT_PREVIEW = 'La vista previa de la transcripción aparecerá aquí.'
const MAX_CHAT_SESSIONS = 24
const MAX_CHAT_MESSAGES = 80
const BASELINE_CHAT_HISTORY_MESSAGES = 8
const BASELINE_CHAT_HISTORY_CHARS = 1200
const OPT_CHAT_HISTORY_MESSAGES = 6
const OPT_USER_HISTORY_CHARS = 600
const OPT_ASSISTANT_HISTORY_CHARS = 300

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

function approxTokens(text: string) {
  return Math.floor((text || '').length / 4)
}

function optimizedHistoryLimit(role: ChatRole) {
  return role === 'user' ? OPT_USER_HISTORY_CHARS : OPT_ASSISTANT_HISTORY_CHARS
}

async function readJsonResponse(response: Response, fallbackMessage: string) {
  const body = await response.text()
  let data: Record<string, unknown> = {}

  if (body.trim()) {
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      if (response.ok) throw new Error('El servidor respondió con JSON inválido.')
    }
  }

  if (!response.ok) {
    const serverError = typeof data.error === 'string' ? data.error : ''
    throw new Error(serverError || `${fallbackMessage} (${response.status} ${response.statusText})`)
  }

  return data
}

function apiErrorMessage(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/502|bad gateway|failed to fetch|networkerror|econnrefused/i.test(message)) {
    return `${action}: FastAPI no está respondiendo en 127.0.0.1:8000. Levanta el backend con "uvicorn main:app --reload --port 8000".`
  }
  return message || action
}

function getRecordingMimeType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  return 'webm'
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function normalizeForDate(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function cleanDateTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '')
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Fecha mencionada'
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function sameOrPast(date: Date, today: Date) {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return a < b
}

function buildDate(day: number, month: number, year: number | undefined, now: Date) {
  const resolvedYear = year ?? now.getFullYear()
  const date = new Date(resolvedYear, month, day)
  if (date.getDate() !== day || date.getMonth() !== month) return null
  if (!year && sameOrPast(date, now)) date.setFullYear(date.getFullYear() + 1)
  return date
}

function importantDateFromDate(date: Date, raw: string): ImportantDate {
  const month = MONTHS[date.getMonth()]
  const day = String(date.getDate()).padStart(2, '0')
  const isoDate = date.toISOString().slice(0, 10)
  return {
    id: isoDate,
    day: month?.short ?? 'FECH',
    num: day,
    title: cleanDateTitle(raw),
    desc: 'Detectada en Lux',
  }
}

function importantDateKey(date: ImportantDate) {
  return date.id.split(':')[0]
}

function dateTitleScore(title: string) {
  const normalized = normalizeForDate(title)
  let score = 0

  if (/\d{1,2}\s+de\s+[a-z]+/.test(normalized)) score += 2
  if (/\b\d{4}\b/.test(normalized)) score += 3
  if (/^\d{1,2}[/-]\d{1,2}/.test(normalized)) score += 1
  if (/\b(hoy|manana|pasado manana)\b/.test(normalized)) score -= 1

  return score
}

function chooseBetterImportantDate(current: ImportantDate, incoming: ImportantDate) {
  const currentScore = dateTitleScore(current.title)
  const incomingScore = dateTitleScore(incoming.title)
  return incomingScore > currentScore ? incoming : current
}

function mergeImportantDates(existing: ImportantDate[], incoming: ImportantDate[]) {
  const byDay = new Map<string, ImportantDate>()

  ;[...existing, ...incoming].forEach((date) => {
    const key = importantDateKey(date)
    const normalizedDate = { ...date, id: key }
    const current = byDay.get(key)
    byDay.set(key, current ? chooseBetterImportantDate(current, normalizedDate) : normalizedDate)
  })

  return Array.from(byDay.values())
    .sort((a, b) => importantDateKey(a).localeCompare(importantDateKey(b)))
    .slice(-8)
}

function parseImportantDates(text: string, now = new Date()): ImportantDate[] {
  const found: ImportantDate[] = []
  const add = (date: Date | null, raw: string) => {
    if (!date) return
    const item = importantDateFromDate(date, raw)
    found.push(item)
  }

  const monthNames = MONTHS.map((month) => month.name).join('|')
  const monthRegex = new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${monthNames})(?:\\s+d(?:e|el)\\s+(\\d{4}))?\\b`, 'gi')
  for (const match of text.matchAll(monthRegex)) {
    const day = Number(match[1])
    const month = MONTHS.find((item) => item.name === normalizeForDate(match[2]))
    const year = match[3] ? Number(match[3]) : undefined
    if (month) add(buildDate(day, month.index, year, now), match[0])
  }

  const numericRegex = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g
  for (const match of text.matchAll(numericRegex)) {
    const day = Number(match[1])
    const month = Number(match[2]) - 1
    let year = match[3] ? Number(match[3]) : undefined
    if (year !== undefined && year < 100) year += 2000
    add(buildDate(day, month, year, now), match[0])
  }

  const normalized = normalizeForDate(text)
  const relativeRegex = /\b(pasado manana|manana|hoy)\b/g
  for (const match of normalized.matchAll(relativeRegex)) {
    const raw = match[0] === 'manana' ? 'mañana' : match[0]
    const days = match[0] === 'hoy' ? 0 : match[0] === 'manana' ? 1 : 2
    add(addDays(now, days), raw)
  }

  const weekdayRegex = /\b(?:(proximo|próximo)\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/gi
  for (const match of text.matchAll(weekdayRegex)) {
    const target = WEEKDAYS[normalizeForDate(match[2])]
    if (target === undefined) continue
    const today = now.getDay()
    let daysAhead = (target - today + 7) % 7
    if (daysAhead === 0 || match[1]) daysAhead += 7
    add(addDays(now, daysAhead), match[0])
  }

  return mergeImportantDates([], found)
}

function isImportantDate(value: unknown): value is ImportantDate {
  if (!value || typeof value !== 'object') return false
  const date = value as Partial<ImportantDate>
  return (
    typeof date.id === 'string' &&
    typeof date.day === 'string' &&
    typeof date.num === 'string' &&
    typeof date.title === 'string' &&
    typeof date.desc === 'string'
  )
}

function loadImportantDates() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(IMPORTANT_DATES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const migrated = mergeImportantDates([], parsed.filter(isImportantDate))
    saveImportantDates(migrated)
    return migrated
  } catch {
    return []
  }
}

function saveImportantDates(dates: ImportantDate[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(IMPORTANT_DATES_STORAGE_KEY, JSON.stringify(dates.slice(-8)))
  } catch {
    // El almacenamiento local puede estar deshabilitado; la sesion actual sigue funcionando.
  }
}

function createChatSessionId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanChatTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Chat sin titulo'
  return clean.length > 58 ? `${clean.slice(0, 55)}...` : clean
}

function titleFromMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content
  return cleanChatTitle(firstUserMessage || messages[0]?.content || '')
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<ChatMessage>
  return (
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  )
}

function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<ChatSession>
  return (
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    typeof session.createdAt === 'string' &&
    typeof session.updatedAt === 'string' &&
    (session.transcript === undefined || typeof session.transcript === 'string') &&
    Array.isArray(session.messages) &&
    session.messages.every(isChatMessage)
  )
}

function normalizeIsoDate(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return new Date().toISOString()
  return new Date(timestamp).toISOString()
}

function normalizeChatSessions(sessions: ChatSession[]) {
  return sessions
    .map((session) => {
      const messages = session.messages.filter(isChatMessage).slice(-MAX_CHAT_MESSAGES)
      return {
        ...session,
        title: cleanChatTitle(session.title || titleFromMessages(messages)),
        createdAt: normalizeIsoDate(session.createdAt),
        updatedAt: normalizeIsoDate(session.updatedAt),
        transcript: typeof session.transcript === 'string' ? session.transcript : '',
        messages,
      }
    })
    .filter((session) => session.messages.length > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_CHAT_SESSIONS)
}

function loadChatSessions() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const sessions = normalizeChatSessions(parsed.filter(isChatSession))
    saveChatSessions(sessions)
    return sessions
  } catch {
    return []
  }
}

function saveChatSessions(sessions: ChatSession[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      CHAT_SESSIONS_STORAGE_KEY,
      JSON.stringify(normalizeChatSessions(sessions)),
    )
  } catch {
    // El historial de chats es auxiliar; si localStorage falla, el chat actual sigue vivo.
  }
}

function hasUsableTranscript(text: string) {
  const clean = text.trim()
  return Boolean(clean) && clean !== DEFAULT_TRANSCRIPT_PREVIEW
}

function parseSseEvent(eventText: string) {
  return eventText
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
}

// Silencio mas largo: la gente hace pausas naturales al hablar y 1300ms cortaba
// mitad de frase. 1900ms permite respirar sin perder palabras.
const VOICE_CHAT_SILENCE_MS = 1900
// Maximo absoluto antes de cortar (preguntas largas con contexto).
const VOICE_CHAT_MAX_MS = 30000
// Si no se detecta nada de voz en 10s, cortar para evitar audio vacio.
const VOICE_CHAT_NO_SPEECH_MS = 10000
// Minimo: evita cortar antes de que la persona arranque a hablar.
const VOICE_CHAT_MIN_MS = 700
// Umbral RMS mas sensible: 0.035 ignoraba voces bajas o lejanas al microfono.
// Se calibra automaticamente al inicio segun el ruido ambiental.
const VOICE_CHAT_RMS_THRESHOLD = 0.018
// Cuanto debe estar la senal por encima del ruido ambiental para contar como voz.
const VOICE_CHAT_NOISE_MARGIN = 0.012
// Tiempo para muestrear el ruido ambiental al inicio.
const VOICE_CHAT_NOISE_CALIBRATION_MS = 350
const RECORDING_CHUNK_MS = 1000
const LIVE_CAPTION_INTERVAL_MS = 5000
const LIVE_CAPTION_CONTEXT_CHARS = 180

function isVoiceChatSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(window.MediaRecorder)
  )
}

function isSpeechOutputSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  )
}

// Convierte el markdown jerarquico del mapa mental en una descripcion narrada
// natural para personas ciegas o con baja vision. Recorre cada nivel del arbol
// y lo describe verbalmente: "El tema central es X. Tiene N ramas: A, B, C.
// La primera rama, A, contiene los siguientes puntos..."
export type VoiceCommand =
  | { type: 'repeat' }
  | { type: 'stop' }
  | { type: 'faster' }
  | { type: 'slower' }
  | { type: 'read-summary' }
  | { type: 'generate-summary' }
  | { type: 'generate-map' }
  | { type: 'describe-map' }
  | { type: 'nav-dashboard' }
  | { type: 'nav-recordings' }
  | { type: 'nav-timeline' }
  | { type: 'reset-chat' }
  | { type: 'toggle-easy' }
  | { type: 'toggle-continuous' }
  | { type: 'help' }

function normalizeCommandText(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectVoiceCommand(text: string): VoiceCommand | null {
  const t = normalizeCommandText(text)
  if (!t) return null

  // Solo se interpretan como comandos las frases cortas (<= 6 palabras).
  // Esto evita capturar una pregunta larga que mencione "lee el resumen".
  const wordCount = t.split(' ').length
  if (wordCount > 7) return null

  if (/^(repite|repetir|repitelo|otra vez|de nuevo|lee de nuevo|lee otra vez|repite por favor)$/.test(t))
    return { type: 'repeat' }
  if (/^(para|parate|silencio|callate|silencia|deja de hablar|deja de leer|alto)$/.test(t))
    return { type: 'stop' }
  if (/^(mas rapido|mas rapida|acelera|sube velocidad|sube la velocidad|habla mas rapido)$/.test(t))
    return { type: 'faster' }
  if (/^(mas despacio|mas lento|mas lenta|baja velocidad|baja la velocidad|habla mas despacio|despacio)$/.test(t))
    return { type: 'slower' }
  if (/^(lee el resumen|lee resumen|leer resumen|leer el resumen|dame el resumen|cual es el resumen)$/.test(t))
    return { type: 'read-summary' }
  if (/^(genera resumen|generar resumen|crea resumen|haz resumen|haz un resumen|generame resumen)$/.test(t))
    return { type: 'generate-summary' }
  if (/^(genera mapa|generar mapa|crea mapa|haz mapa|haz un mapa|generar mapa mental|genera el mapa mental)$/.test(t))
    return { type: 'generate-map' }
  if (/^(describe mapa|describe el mapa|narra mapa|narra el mapa|describe el mapa mental|lee el mapa mental|lee mapa)$/.test(t))
    return { type: 'describe-map' }
  if (/^(abre el chat|ir al chat|volver al chat|chat|panel principal|inicio|abre inicio)$/.test(t))
    return { type: 'nav-dashboard' }
  if (/^(abre grabaciones|ir a grabaciones|abre la pagina de grabaciones|grabaciones)$/.test(t))
    return { type: 'nav-recordings' }
  if (/^(abre timeline|ir a timeline|abre linea de tiempo|linea de tiempo|historial|abre historial)$/.test(t))
    return { type: 'nav-timeline' }
  if (/^(borra el chat|limpia el chat|nuevo chat|empieza nuevo chat|reinicia el chat)$/.test(t))
    return { type: 'reset-chat' }
  if (/^(modo lectura facil|activa lectura facil|desactiva lectura facil|alternar lectura facil|lectura facil)$/.test(t))
    return { type: 'toggle-easy' }
  if (/^(modo continuo|conversacion continua|activa conversacion continua|desactiva conversacion continua)$/.test(t))
    return { type: 'toggle-continuous' }
  if (/^(ayuda|que comandos|cuales son los comandos|que puedo decir|que comandos hay)$/.test(t))
    return { type: 'help' }

  return null
}

const VOICE_COMMAND_HELP =
  'Comandos disponibles: repite, para, mas rapido, mas despacio, lee el resumen, genera resumen, ' +
  'genera mapa mental, describe el mapa mental, abre grabaciones, abre el chat, abre historial, ' +
  'nuevo chat, activa lectura facil, conversacion continua.'

function mindMapToNarration(markdown: string): string {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return 'No hay mapa mental disponible.'

  type Node = { title: string; children: Node[] }
  const root: Node = { title: '', children: [] }
  const stack: Array<{ level: number; node: Node }> = [{ level: 0, node: root }]

  for (const line of lines) {
    const headingMatch = /^(#+)\s+(.*)$/.exec(line)
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const node: Node = { title: headingMatch[2].trim(), children: [] }
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop()
      stack[stack.length - 1].node.children.push(node)
      stack.push({ level, node })
    } else if (bulletMatch) {
      const node: Node = { title: bulletMatch[1].trim(), children: [] }
      const lastLevel = stack[stack.length - 1].level
      stack[stack.length - 1].node.children.push(node)
      stack.push({ level: lastLevel + 1, node })
      // Los bullets son hojas; los sacamos del stack para que el siguiente
      // bullet hermano se anada al mismo padre.
      stack.pop()
    }
  }

  if (root.children.length === 0) {
    return 'El mapa mental no tiene contenido estructurado.'
  }

  const central = root.children[0]
  const parts: string[] = [`El tema central del mapa mental es: ${central.title}.`]
  const ramas = central.children
  if (ramas.length === 0) {
    parts.push('No tiene ramas registradas.')
  } else {
    parts.push(`Tiene ${ramas.length} ${ramas.length === 1 ? 'rama' : 'ramas'} principales.`)
    ramas.forEach((rama, index) => {
      const ordinal = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'][index] || `rama número ${index + 1}`
      parts.push(`La ${ordinal} rama es: ${rama.title}.`)
      if (rama.children.length > 0) {
        parts.push(
          `Incluye los siguientes puntos: ${rama.children.map((c) => c.title).join('; ')}.`,
        )
      }
    })
  }

  return parts.join(' ')
}

function responseTextForSpeech(text: string) {
  const withoutSource = text
    .replace(/^Fuente\s*:.*$/gim, '')
    .replace(/^Respuesta\s*:\s*/gim, '')
    .replace(/\s+/g, ' ')
    .trim()

  return withoutSource || text.replace(/\s+/g, ' ').trim()
}

function spanishVoice(preferredUri?: string | null) {
  if (!isSpeechOutputSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  if (preferredUri) {
    const exact = voices.find((voice) => voice.voiceURI === preferredUri)
    if (exact) return exact
  }
  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith('es-mx')) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('es')) ||
    null
  )
}

function loadTtsRate(): number {
  if (typeof window === 'undefined') return 1
  try {
    const raw = window.localStorage.getItem(TTS_RATE_STORAGE_KEY)
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 3) return parsed
    return 1
  } catch {
    return 1
  }
}

function saveTtsRate(rate: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TTS_RATE_STORAGE_KEY, String(rate))
  } catch {
    // ignorado
  }
}

function loadTtsVoiceUri(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TTS_VOICE_STORAGE_KEY)
  } catch {
    return null
  }
}

function saveTtsVoiceUri(uri: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (uri) {
      window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, uri)
    } else {
      window.localStorage.removeItem(TTS_VOICE_STORAGE_KEY)
    }
  } catch {
    // ignorado
  }
}

function loadBargeIn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(BARGE_IN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveBargeIn(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(BARGE_IN_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignorado
  }
}

function loadEasyRead(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(EASY_READ_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveEasyRead(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EASY_READ_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignorado
  }
}

function loadSelectedMicrophoneId() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(MICROPHONE_STORAGE_KEY)
  } catch {
    return null
  }
}

function saveSelectedMicrophoneId(deviceId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (deviceId) {
      window.localStorage.setItem(MICROPHONE_STORAGE_KEY, deviceId)
    } else {
      window.localStorage.removeItem(MICROPHONE_STORAGE_KEY)
    }
  } catch {
    // Si localStorage falla, mantenemos la seleccion solo en memoria.
  }
}

function pickDefaultMicrophoneId(devices: MediaDeviceInfo[]) {
  // Filtramos dispositivos que requieren red (iPhone Continuity) y AirPods
  // para evitar depender de Wi-Fi/Bluetooth de forma silenciosa.
  const offlineDevices = devices.filter((device) => !isNetworkDependentMic(device.label))
  const built = offlineDevices.find((device) => /built.?in|macbook|integrado/i.test(device.label))
  return built?.deviceId || offlineDevices[0]?.deviceId || devices[0]?.deviceId || null
}

function rmsFromTimeDomain(data: Uint8Array) {
  let sum = 0
  for (const value of data) {
    const sample = (value - 128) / 128
    sum += sample * sample
  }
  return Math.sqrt(sum / data.length)
}

// Reproduce un beep corto via Web Audio API. Critico para accesibilidad:
// las personas ciegas no ven el cambio visual del boton, asi que un tono
// audible confirma que la grabacion arranco o termino.
function playBeep(frequency: number, durationMs: number) {
  if (typeof window === 'undefined') return
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    const ctx = new AudioContextClass()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    // Sobre que termina abrupto, mejor con fade-out suave.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + durationMs / 1000 + 0.02)
    oscillator.onended = () => {
      void ctx.close().catch(() => undefined)
    }
  } catch {
    // El usuario no autorizo audio aun; silenciar el fallo.
  }
}

function beepListenStart() {
  playBeep(880, 120)
}

function beepListenStop() {
  playBeep(440, 140)
}

function beepError() {
  playBeep(220, 220)
}

function normalizeCaptionForCompare(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeCaptionText(current: string, incoming: string) {
  const next = incoming.replace(/\s+/g, ' ').trim()
  if (!next) return current
  if (!current.trim()) return next

  const normalizedCurrent = normalizeCaptionForCompare(current)
  const normalizedNext = normalizeCaptionForCompare(next)
  if (normalizedCurrent.endsWith(normalizedNext)) return current

  const currentSentences = new Set(
    current
      .split(/(?<=[.!?])\s+/)
      .map(normalizeCaptionForCompare)
      .filter((sentence) => sentence.length >= 10),
  )
  const filteredNext = next
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !currentSentences.has(normalizeCaptionForCompare(sentence)))
    .join(' ')
  if (!filteredNext) return current

  const maxOverlap = Math.min(120, current.length, filteredNext.length)
  for (let size = maxOverlap; size >= 16; size -= 1) {
    const currentTail = normalizeCaptionForCompare(current.slice(-size))
    const nextHead = normalizeCaptionForCompare(filteredNext.slice(0, size))
    if (currentTail && currentTail === nextHead) {
      return `${current}${filteredNext.slice(size)}`
    }
  }

  return `${current.trimEnd()} ${filteredNext}`
}

export function useMinutero() {
  const fileRef = useRef<File | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<BlobPart[]>([])
  const captionRecorderRef = useRef<MediaRecorder | null>(null)
  const captionStreamRef = useRef<MediaStream | null>(null)
  const captionChunksRef = useRef<BlobPart[]>([])
  const captionUploadChainRef = useRef(Promise.resolve())
  const captionRunIdRef = useRef(0)
  const liveCaptionTextRef = useRef('')
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingUrlRef = useRef<string | null>(null)
  const liveCaptionIntervalRef = useRef<number | null>(null)
  const liveCaptionAbortRef = useRef<AbortController | null>(null)
  const chatVoiceRecorderRef = useRef<MediaRecorder | null>(null)
  const chatVoiceStreamRef = useRef<MediaStream | null>(null)
  const chatVoiceChunksRef = useRef<BlobPart[]>([])
  const chatVoiceAudioContextRef = useRef<AudioContext | null>(null)
  const chatVoiceAnalyserFrameRef = useRef<number | null>(null)
  const chatVoiceStartedAtRef = useRef(0)
  const chatVoiceLastSignalAtRef = useRef(0)
  const chatVoiceDetectedSpeechRef = useRef(false)
  const chatVoiceNoiseFloorRef = useRef(VOICE_CHAT_RMS_THRESHOLD)
  const chatVoiceNoiseSamplesRef = useRef<number[]>([])
  const chatVoiceContinuousRef = useRef(false)
  // Forward-ref para que speakAssistant invoque startVoiceChat sin crear un
  // ciclo de dependencias entre los dos callbacks.
  const startVoiceChatRef = useRef<(() => Promise<void>) | null>(null)
  const navigationHandlerRef = useRef<((command: VoiceCommand) => boolean) | null>(null)
  // Referencias para barge-in: escucha pasiva durante TTS para detectar si el
  // usuario empieza a hablar y, en ese caso, cancelar la voz y abrir mic.
  const bargeInStreamRef = useRef<MediaStream | null>(null)
  const bargeInContextRef = useRef<AudioContext | null>(null)
  const bargeInFrameRef = useRef<number | null>(null)
  // Forward-ref para que speakAssistant active barge-in sin generar ciclos.
  const startBargeInListenerRef = useRef<(() => Promise<void>) | null>(null)
  const stopBargeInListenerRef = useRef<(() => void) | null>(null)
  const initialChatSessionsRef = useRef<ChatSession[] | null>(null)

  if (initialChatSessionsRef.current === null) {
    initialChatSessionsRef.current = loadChatSessions()
  }

  const initialChatSessions = initialChatSessionsRef.current ?? []

  const [ollamaOk, setOllamaOk] = useState(false)
  const [modelOk, setModelOk] = useState(false)
  const [modelName, setModelName] = useState('')
  const [chunkCount, setChunkCount] = useState(0)
  const [workEnabled, setWorkEnabled] = useState(false)

  const [fileMeta, setFileMeta] = useState('')
  const [indexBtnDisabled, setIndexBtnDisabled] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('Selecciona un archivo para empezar.')
  const [preview, setPreview] = useState(initialChatSessions[0]?.transcript || DEFAULT_TRANSCRIPT_PREVIEW)
  const [isDragOver, setIsDragOver] = useState(false)

  const [liveCaption, setLiveCaption] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordingTime, setRecordingTime] = useState('00:00')
  const [recordingUrl, setRecordingUrl] = useState('')
  const [markers, setMarkers] = useState<string[]>([])

  const [summaryOutput, setSummaryOutput] = useState('')
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [mapGenerating, setMapGenerating] = useState(false)
  const [mapMarkdown, setMapMarkdown] = useState('')

  const [question, setQuestion] = useState('')
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(initialChatSessions)
  const [activeChatId, setActiveChatId] = useState<string | null>(initialChatSessions[0]?.id ?? null)
  const [conversation, setConversation] = useState<ChatMessage[]>(initialChatSessions[0]?.messages ?? [])
  const [importantDates, setImportantDates] = useState<ImportantDate[]>(loadImportantDates)
  const [isChatting, setIsChatting] = useState(false)
  const [voiceChatSupported] = useState(isVoiceChatSupported)
  const [speechSupported] = useState(isSpeechOutputSupported)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [continuousVoice, setContinuousVoice] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState(
    'Pulsa Hablar o la tecla Espacio para dictar un mensaje.',
  )
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState('')
  const [ttsRate, setTtsRateState] = useState<number>(loadTtsRate)
  const [ttsVoiceUri, setTtsVoiceUriState] = useState<string | null>(loadTtsVoiceUri)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [easyRead, setEasyReadState] = useState<boolean>(loadEasyRead)
  const [bargeInEnabled, setBargeInEnabledState] = useState<boolean>(loadBargeIn)
  const bargeInRef = useRef(bargeInEnabled)
  useEffect(() => {
    bargeInRef.current = bargeInEnabled
  }, [bargeInEnabled])
  const ttsRateRef = useRef(ttsRate)
  const ttsVoiceUriRef = useRef<string | null>(ttsVoiceUri)
  const easyReadRef = useRef(easyRead)
  useEffect(() => {
    ttsRateRef.current = ttsRate
  }, [ttsRate])
  useEffect(() => {
    ttsVoiceUriRef.current = ttsVoiceUri
  }, [ttsVoiceUri])
  useEffect(() => {
    easyReadRef.current = easyRead
  }, [easyRead])
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | null>(
    loadSelectedMicrophoneId,
  )
  const selectedMicrophoneIdRef = useRef<string | null>(selectedMicrophoneId)
  useEffect(() => {
    selectedMicrophoneIdRef.current = selectedMicrophoneId
  }, [selectedMicrophoneId])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/estado')
      const data = await readJsonResponse(res, 'No se pudo consultar el estado local')
      setOllamaOk(Boolean(data.ollama))
      setModelOk(Boolean(data.modelo))
      setModelName(String(data.modelo_nombre || ''))
      setChunkCount(Number(data.chunks_indexados) || 0)
      setWorkEnabled(Number(data.chunks_indexados) > 0)
    } catch {
      setOllamaOk(false)
      setModelOk(false)
      setModelName('')
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    chatVoiceContinuousRef.current = continuousVoice
  }, [continuousVoice])

  // Las voces del navegador se cargan asincronamente. Hay que escuchar
  // voiceschanged para mostrarlas al usuario, especialmente la primera vez.
  useEffect(() => {
    if (!isSpeechOutputSupported()) return
    const updateVoices = () => {
      const allVoices = window.speechSynthesis.getVoices()
      const spanish = allVoices.filter((voice) => voice.lang.toLowerCase().startsWith('es'))
      setAvailableVoices(spanish.length > 0 ? spanish : allVoices)
    }
    updateVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', updateVoices)
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', updateVoices)
    }
  }, [])

  const setTtsRate = useCallback((rate: number) => {
    const bounded = Math.min(3, Math.max(0.5, Number.isFinite(rate) ? rate : 1))
    setTtsRateState(bounded)
    saveTtsRate(bounded)
  }, [])

  const setTtsVoiceUri = useCallback((uri: string | null) => {
    setTtsVoiceUriState(uri)
    saveTtsVoiceUri(uri)
  }, [])

  const setEasyRead = useCallback((enabled: boolean) => {
    setEasyReadState(enabled)
    saveEasyRead(enabled)
  }, [])

  const setBargeIn = useCallback((enabled: boolean) => {
    setBargeInEnabledState(enabled)
    saveBargeIn(enabled)
  }, [])

  const stopBargeInListener = useCallback(() => {
    if (bargeInFrameRef.current) {
      window.cancelAnimationFrame(bargeInFrameRef.current)
      bargeInFrameRef.current = null
    }
    bargeInStreamRef.current?.getTracks().forEach((track) => track.stop())
    bargeInStreamRef.current = null
    void bargeInContextRef.current?.close().catch(() => undefined)
    bargeInContextRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      chatVoiceStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (chatVoiceAnalyserFrameRef.current) {
        window.cancelAnimationFrame(chatVoiceAnalyserFrameRef.current)
      }
      void chatVoiceAudioContextRef.current?.close().catch(() => undefined)
      if (bargeInFrameRef.current) {
        window.cancelAnimationFrame(bargeInFrameRef.current)
      }
      bargeInStreamRef.current?.getTracks().forEach((track) => track.stop())
      void bargeInContextRef.current?.close().catch(() => undefined)
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
      if (isSpeechOutputSupported()) window.speechSynthesis.cancel()
    }
  }, [])

  const persistChatSessions = useCallback((updater: (prev: ChatSession[]) => ChatSession[]) => {
    setChatSessions((prev) => {
      const saved = normalizeChatSessions(updater(prev))
      saveChatSessions(saved)
      return saved
    })
  }, [])

  const upsertChatSession = useCallback(
    (sessionId: string, messages: ChatMessage[], fallbackTitle?: string) => {
      const now = new Date().toISOString()

      persistChatSessions((prev) => {
        const existing = prev.find((session) => session.id === sessionId)
        const nextSession: ChatSession = {
          id: sessionId,
          title: existing?.title || cleanChatTitle(fallbackTitle || titleFromMessages(messages)),
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          transcript: existing?.transcript || preview,
          messages,
        }

        return [nextSession, ...prev.filter((session) => session.id !== sessionId)]
      })
    },
    [persistChatSessions, preview],
  )

  const resetConversation = useCallback(() => {
    setActiveChatId(null)
    setConversation([])
    setQuestion('')
  }, [])

  const openChatSession = useCallback(
    (sessionId: string) => {
      const session = chatSessions.find((item) => item.id === sessionId)
      if (!session) return
      const restoredTranscript =
        session.transcript || (hasUsableTranscript(preview) ? preview : DEFAULT_TRANSCRIPT_PREVIEW)

      setActiveChatId(session.id)
      setConversation(session.messages)
      setPreview(restoredTranscript)
      setQuestion('')

      if (!session.transcript && hasUsableTranscript(restoredTranscript)) {
        persistChatSessions((prev) =>
          prev.map((item) =>
            item.id === session.id ? { ...item, transcript: restoredTranscript } : item,
          ),
        )
      }
    },
    [chatSessions, persistChatSessions, preview],
  )

  const captureImportantDates = useCallback((text: string) => {
    const detected = parseImportantDates(text)
    if (!detected.length) return

    setImportantDates((prev) => {
      const saved = mergeImportantDates(prev, detected)
      saveImportantDates(saved)
      return saved
    })
  }, [])

  useEffect(() => {
    if (!summaryGenerating && summaryOutput) {
      captureImportantDates(summaryOutput)
    }
  }, [captureImportantDates, summaryGenerating, summaryOutput])

  const selectFile = useCallback((file: File) => {
    fileRef.current = file
    setFileMeta(`${file.name} · ${formatBytes(file.size)}`)
    setIndexBtnDisabled(false)
    setUploadMessage('Archivo listo para procesar.')
  }, [])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (file) selectFile(file)
    },
    [selectFile],
  )

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }, [])

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const stopLiveCaptionLoop = useCallback(() => {
    captionRunIdRef.current += 1
    if (liveCaptionIntervalRef.current) {
      window.clearInterval(liveCaptionIntervalRef.current)
      liveCaptionIntervalRef.current = null
    }
    liveCaptionAbortRef.current?.abort()
    liveCaptionAbortRef.current = null
    captionUploadChainRef.current = Promise.resolve()
    const captionRecorder = captionRecorderRef.current
    captionRecorderRef.current = null
    if (captionRecorder && captionRecorder.state !== 'inactive') {
      captionRecorder.ondataavailable = null
      captionRecorder.onstop = null
      try {
        captionRecorder.stop()
      } catch {
        // Puede estar cerrandose por un tick del intervalo.
      }
    }
    captionChunksRef.current = []
    captionStreamRef.current?.getTracks().forEach((track) => track.stop())
    captionStreamRef.current = null
  }, [])

  // Envia bloques cortos e independientes al endpoint /caption y conserva el
  // transcript completo. Esto evita mandar a Whisper audios cada vez mas largos.
  const startLiveCaptionLoop = useCallback((stream: MediaStream, mimeType: string) => {
    stopLiveCaptionLoop()
    const runId = captionRunIdRef.current + 1
    captionRunIdRef.current = runId
    captionUploadChainRef.current = Promise.resolve()
    liveCaptionTextRef.current = ''
    setLiveCaption('')

    const captionStream = stream.clone()
    captionStreamRef.current = captionStream

    const enviarBlobCaption = async (blob: Blob) => {
      if (captionRunIdRef.current !== runId) return
      if (blob.size < 4000) return // muy poco audio, omitimos

      const file = new File([blob], `caption.${extensionForMimeType(blob.type)}`, {
        type: blob.type,
      })
      const form = new FormData()
      form.append('audio', file)
      form.append('contexto', liveCaptionTextRef.current.slice(-LIVE_CAPTION_CONTEXT_CHARS))

      const controller = new AbortController()
      liveCaptionAbortRef.current = controller
      try {
        const response = await fetch('/caption', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        })
        const data = await readJsonResponse(response, 'No se pudieron generar subtítulos')
        if (captionRunIdRef.current !== runId) return
        const texto = String(data?.texto || '').trim()
        if (texto) {
          const merged = mergeCaptionText(liveCaptionTextRef.current, texto)
          liveCaptionTextRef.current = merged
          setLiveCaption(merged)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setUploadMessage(apiErrorMessage('Subtítulos en vivo pausados', error))
        stopLiveCaptionLoop()
      } finally {
        if (liveCaptionAbortRef.current === controller) {
          liveCaptionAbortRef.current = null
        }
      }
    }

    const iniciarSegmentoCaption = () => {
      if (!captionStream.active || !window.MediaRecorder) return
      try {
        const recorder = new MediaRecorder(captionStream, mimeType ? { mimeType } : undefined)
        captionChunksRef.current = []
        captionRecorderRef.current = recorder

        recorder.ondataavailable = (event) => {
          if (event.data?.size > 0) captionChunksRef.current.push(event.data)
        }

        recorder.onstop = () => {
          const chunks = captionChunksRef.current
          captionChunksRef.current = []
          captionRecorderRef.current = null

          if (liveCaptionIntervalRef.current && mediaRecorderRef.current?.state === 'recording') {
            iniciarSegmentoCaption()
          }

          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
            captionUploadChainRef.current = captionUploadChainRef.current
              .then(() => enviarBlobCaption(blob))
              .catch(() => undefined)
          }
        }

        recorder.start()
      } catch {
        // Si el navegador no permite un recorder secundario, simplemente se
        // omite el captioning sin afectar la grabacion principal.
      }
    }

    iniciarSegmentoCaption()
    liveCaptionIntervalRef.current = window.setInterval(() => {
      const recorder = captionRecorderRef.current
      if (recorder?.state === 'recording') {
        recorder.stop()
      }
    }, LIVE_CAPTION_INTERVAL_MS)
  }, [stopLiveCaptionLoop])

  const startRecordingTimer = useCallback(() => {
    recordingStartedAtRef.current = Date.now()
    setRecordingTime('00:00')
    stopRecordingTimer()
    recordingTimerRef.current = window.setInterval(() => {
      if (recordingStartedAtRef.current) {
        setRecordingTime(formatDuration(Date.now() - recordingStartedAtRef.current))
      }
    }, 250)
  }, [stopRecordingTimer])

  const finishRecording = useCallback(
    (mimeType: string) => {
      stopRecordingTimer()
      stopMediaStream()
      stopLiveCaptionLoop()
      setIsRecording(false)
      setIsPaused(false)

      const blob = new Blob(recordingChunksRef.current, { type: mimeType || 'audio/webm' })
      recordingChunksRef.current = []

      if (!blob.size) {
        setUploadMessage('No se capturó audio del micrófono.')
        return
      }

      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
      const url = URL.createObjectURL(blob)
      recordingUrlRef.current = url
      setRecordingUrl(url)

      const extension = extensionForMimeType(blob.type)
      const file = new File([blob], `grabacion-minutero.${extension}`, {
        type: blob.type,
        lastModified: Date.now(),
      })

      selectFile(file)
      setUploadMessage('Grabación lista para transcribir e indexar.')
    },
    [selectFile, stopLiveCaptionLoop, stopMediaStream, stopRecordingTimer],
  )

  const refreshMicrophones = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [] as MediaDeviceInfo[]
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter((device) => device.kind === 'audioinput')
      setMicrophones(audioInputs)

      // Si el usuario no ha elegido nada todavia, o el dispositivo guardado ya
      // no existe, escogemos automaticamente uno que no requiera red.
      const currentId = selectedMicrophoneIdRef.current
      const stillExists = currentId && audioInputs.some((device) => device.deviceId === currentId)
      if (!stillExists) {
        const fallback = pickDefaultMicrophoneId(audioInputs)
        setSelectedMicrophoneId(fallback)
        saveSelectedMicrophoneId(fallback)
      }
      return audioInputs
    } catch {
      return [] as MediaDeviceInfo[]
    }
  }, [])

  const selectMicrophone = useCallback((deviceId: string | null) => {
    setSelectedMicrophoneId(deviceId)
    saveSelectedMicrophoneId(deviceId)
  }, [])

  // Construye las constraints de audio. Si el usuario eligio un microfono
  // especifico, lo forzamos con deviceId: { exact }. Asi getUserMedia falla
  // (en vez de caer en el iPhone Continuity) si el microfono elegido no esta
  // conectado, lo que es preferible para una app que debe funcionar offline.
  const buildAudioConstraints = useCallback((): MediaTrackConstraints => {
    const base: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 16000,
      channelCount: 1,
    }
    const deviceId = selectedMicrophoneIdRef.current
    if (deviceId) {
      base.deviceId = { exact: deviceId }
    }
    return base
  }, [])

  // Refrescamos la lista de microfonos cuando el usuario conecta o desconecta
  // un dispositivo (audifonos, USB, iPhone Continuity).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
    const handler = () => {
      void refreshMicrophones()
    }
    navigator.mediaDevices.addEventListener?.('devicechange', handler)
    void refreshMicrophones()
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', handler)
    }
  }, [refreshMicrophones])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setUploadMessage('Este navegador no permite grabar audio desde la página.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(),
      })
      void refreshMicrophones()
      const mimeType = getRecordingMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingChunksRef.current = []

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size > 0) recordingChunksRef.current.push(event.data)
      })

      recorder.addEventListener('stop', () => {
        finishRecording(recorder.mimeType || mimeType)
      })

      recorder.start(RECORDING_CHUNK_MS)
      setIsRecording(true)
      setIsPaused(false)
      setMarkers([])
      setUploadMessage('Grabando localmente. Subtítulos en vivo activos.')
      startRecordingTimer()
      startLiveCaptionLoop(stream, recorder.mimeType || mimeType)
    } catch {
      setIsRecording(false)
      setIsPaused(false)
      stopRecordingTimer()
      stopMediaStream()
      setUploadMessage('No se pudo acceder al micrófono.')
    }
  }, [
    finishRecording,
    buildAudioConstraints,
    refreshMicrophones,
    startLiveCaptionLoop,
    startRecordingTimer,
    stopMediaStream,
    stopRecordingTimer,
  ])

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return

    if (recorder.state === 'recording') {
      recorder.pause()
      if (captionRecorderRef.current?.state === 'recording') {
        captionRecorderRef.current.pause()
      }
      setIsPaused(true)
      setUploadMessage('Grabación pausada.')
      stopRecordingTimer()
    } else if (recorder.state === 'paused') {
      recorder.resume()
      if (captionRecorderRef.current?.state === 'paused') {
        captionRecorderRef.current.resume()
      }
      setIsPaused(false)
      setUploadMessage('Grabando localmente. Subtítulos en vivo activos.')
      startRecordingTimer()
    }
  }, [startRecordingTimer, stopRecordingTimer])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
    setUploadMessage('Preparando grabación...')
  }, [])

  const addMarker = useCallback(() => {
    const label = `Marca en ${recordingTime}`
    setMarkers((prev) => [label, ...prev].slice(0, 5))
    setUploadMessage(`${label} guardada localmente.`)
  }, [recordingTime])

  const indexAudio = useCallback(async () => {
    const file = fileRef.current
    if (!file) return

    const form = new FormData()
    form.append('audio', file)
    setIsWorking(true)
    setIndexBtnDisabled(true)
    setUploadMessage('Transcribiendo... esto tarda ~30 seg por cada 10 min de audio')

    try {
      const res = await fetch('/indexar', { method: 'POST', body: form })
      const data = await readJsonResponse(res, 'No se pudo indexar el audio')
      const previewText = typeof data.preview === 'string' ? data.preview : 'Audio procesado.'
      const indexedChunks = Number(data.chunks) || 0
      if (!Boolean(data.ok)) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'No se pudo indexar el audio.',
        )
      }
      setPreview(previewText)
      captureImportantDates(previewText)
      setUploadMessage(`Listo. ${indexedChunks} chunks indexados.`)
      setWorkEnabled(true)
      setSummaryOutput('')
      setMapMarkdown('')
      resetConversation()
      await refreshStatus()
    } catch (error) {
      setUploadMessage(apiErrorMessage('No se pudo indexar el audio', error))
      setIndexBtnDisabled(false)
    } finally {
      setIsWorking(false)
    }
  }, [captureImportantDates, refreshStatus, resetConversation])

  const streamTo = useCallback(
    (
      url: string,
      onToken: (token: string, full: string) => void,
      onDone?: (full: string) => void,
      onError?: (message: string) => void,
    ) => {
      let full = ''
      let rewriting = false
      const es = new EventSource(url)
      es.onmessage = (event) => {
        if (event.data === '[DONE]') {
          es.close()
          onDone?.(full)
          return
        }
        if (event.data.startsWith('[ERROR]')) {
          es.close()
          onError?.(event.data)
          return
        }
        // Marcador especial del backend: lo que viene despues reemplaza al
        // texto acumulado (post-procesado del modo seguro).
        if (event.data === '[[REWRITE]]') {
          rewriting = true
          full = ''
          onToken('', full)
          return
        }
        if (rewriting) {
          full += event.data
          onToken(event.data, full)
          return
        }
        full += event.data
        onToken(event.data, full)
      }
      es.onerror = () => {
        es.close()
        onError?.('No se pudo completar la generación. Revisa que Ollama siga corriendo.')
      }
    },
    [],
  )

  const generateSummary = useCallback(() => {
    setSummaryGenerating(true)
    setSummaryOutput('Cargando modelo local...')
    streamTo(
      '/resumir',
      (_token, full) => setSummaryOutput(full),
      (full) => {
        captureImportantDates(full)
        setSummaryGenerating(false)
      },
      (message) => {
        setSummaryOutput(message)
        setSummaryGenerating(false)
      },
    )
  }, [captureImportantDates, streamTo])

  const generateMap = useCallback(() => {
    setMapMarkdown('')
    setMapGenerating(true)
    streamTo(
      '/mapa',
      () => undefined,
      (full) => {
        setMapMarkdown(full)
        setMapGenerating(false)
      },
      (message) => {
        setMapMarkdown(message)
        setMapGenerating(false)
      },
    )
  }, [streamTo])

  const stopSpeaking = useCallback(() => {
    if (!speechSupported) return
    window.speechSynthesis.cancel()
    setIsSpeaking(false)
    setVoiceStatus('Audio de respuesta detenido.')
  }, [speechSupported])

  const speakAssistant = useCallback(
    (text: string) => {
      if (!speechSupported) {
        setVoiceStatus('Este navegador no tiene salida de voz disponible.')
        return
      }

      const cleanText = responseTextForSpeech(text)
      if (!cleanText) return

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(cleanText)
      const voice = spanishVoice(ttsVoiceUriRef.current)
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang || 'es-MX'
      utterance.rate = ttsRateRef.current
      utterance.pitch = 1
      utterance.onstart = () => {
        setIsSpeaking(true)
        setVoiceStatus('Respondiendo con audio.')
        // Activa barge-in: micrófono pasivo escuchando si el usuario interrumpe.
        if (bargeInRef.current) {
          void startBargeInListenerRef.current?.()
        }
      }
      utterance.onend = () => {
        setIsSpeaking(false)
        stopBargeInListenerRef.current?.()
        if (chatVoiceContinuousRef.current) {
          setVoiceStatus('Escuchando de nuevo... tu turno.')
          // Pequeno respiro antes de reabrir el microfono para evitar
          // captar el final del audio de la respuesta.
          window.setTimeout(() => {
            if (chatVoiceContinuousRef.current) {
              void startVoiceChatRef.current?.()
            }
          }, 250)
        } else {
          setVoiceStatus('Listo para escuchar otro mensaje.')
        }
      }
      utterance.onerror = () => {
        setIsSpeaking(false)
        stopBargeInListenerRef.current?.()
        setVoiceStatus('No se pudo reproducir la respuesta con voz.')
      }

      window.speechSynthesis.speak(utterance)
    },
    [speechSupported],
  )

  const speakLastAssistant = useCallback(() => {
    const lastAssistant = [...conversation].reverse().find((message) => message.role === 'assistant')
    if (lastAssistant) speakAssistant(lastAssistant.content)
  }, [conversation, speakAssistant])

  const describeMindMap = useCallback(() => {
    if (!mapMarkdown.trim()) {
      const aviso = 'Aun no hay mapa mental generado. Genera uno primero.'
      setVoiceStatus(aviso)
      speakAssistant(aviso)
      return
    }
    const narration = mindMapToNarration(mapMarkdown)
    setVoiceStatus('Narrando el mapa mental...')
    speakAssistant(narration)
  }, [mapMarkdown, speakAssistant])

  const toggleContinuousVoice = useCallback(() => {
    setContinuousVoice((prev) => {
      const next = !prev
      if (next) {
        setVoiceStatus(
          'Modo conversación continua activado. El micrófono se reabrirá después de cada respuesta.',
        )
      } else {
        setVoiceStatus('Modo conversación continua desactivado.')
      }
      return next
    })
  }, [])

  const registerNavigationHandler = useCallback(
    (handler: ((command: VoiceCommand) => boolean) | null) => {
      navigationHandlerRef.current = handler
    },
    [],
  )

  const runVoiceCommand = useCallback(
    (command: VoiceCommand): boolean => {
      switch (command.type) {
        case 'repeat':
          speakLastAssistant()
          setVoiceStatus('Repitiendo la última respuesta...')
          return true
        case 'stop':
          stopSpeaking()
          return true
        case 'faster': {
          const next = Math.min(3, ttsRateRef.current + 0.25)
          setTtsRate(next)
          const aviso = `Velocidad ${next.toFixed(2)} veces.`
          setVoiceStatus(aviso)
          speakAssistant(aviso)
          return true
        }
        case 'slower': {
          const next = Math.max(0.5, ttsRateRef.current - 0.25)
          setTtsRate(next)
          const aviso = `Velocidad ${next.toFixed(2)} veces.`
          setVoiceStatus(aviso)
          speakAssistant(aviso)
          return true
        }
        case 'read-summary':
          if (summaryOutput.trim()) {
            speakAssistant(summaryOutput)
            setVoiceStatus('Leyendo el resumen...')
          } else {
            speakAssistant('No hay resumen generado. Genera uno primero.')
          }
          return true
        case 'describe-map':
          describeMindMap()
          return true
        case 'reset-chat':
          resetConversation()
          speakAssistant('Chat reiniciado.')
          return true
        case 'toggle-easy': {
          const next = !easyReadRef.current
          setEasyRead(next)
          speakAssistant(
            next ? 'Modo lectura fácil activado.' : 'Modo lectura fácil desactivado.',
          )
          return true
        }
        case 'toggle-continuous':
          toggleContinuousVoice()
          return true
        case 'help':
          speakAssistant(VOICE_COMMAND_HELP)
          setVoiceStatus(VOICE_COMMAND_HELP)
          return true
        case 'generate-summary':
        case 'generate-map':
        case 'nav-dashboard':
        case 'nav-recordings':
        case 'nav-timeline': {
          // Estos comandos viven fuera del hook (App.tsx tiene setView y los
          // ref para generar resumen). Delegamos al handler registrado.
          const handler = navigationHandlerRef.current
          if (handler && handler(command)) return true
          speakAssistant('Este comando no está disponible en esta pantalla.')
          return true
        }
        default:
          return false
      }
    },
    [
      describeMindMap,
      resetConversation,
      setEasyRead,
      setTtsRate,
      speakAssistant,
      speakLastAssistant,
      stopSpeaking,
      summaryOutput,
      toggleContinuousVoice,
    ],
  )

  const streamChat = useCallback(
    async (message: string, options?: { speakResponse?: boolean }) => {
      const cleanMessage = message.trim()
      if (!cleanMessage || isChatting) return
      captureImportantDates(cleanMessage)

      const baseConversation = conversation
      const sessionId = activeChatId || createChatSessionId()
      const userMessage: ChatMessage = { role: 'user', content: cleanMessage }
      const loadingMessage: ChatMessage = { role: 'assistant', content: 'Cargando modelo local...' }
      const loadingConversation = [...baseConversation, userMessage, loadingMessage]

      if (!activeChatId) setActiveChatId(sessionId)

      const baselineHistoryForRequest = baseConversation
        .slice(-BASELINE_CHAT_HISTORY_MESSAGES)
        .map((turn) => ({
          role: turn.role,
          content: turn.content.slice(0, BASELINE_CHAT_HISTORY_CHARS),
        }))

      const historyForRequest = baseConversation.slice(-OPT_CHAT_HISTORY_MESSAGES).map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, optimizedHistoryLimit(turn.role)),
      }))
      const baselineHistoryChars = baselineHistoryForRequest.reduce(
        (total, turn) => total + turn.content.length,
        0,
      )
      const historyChars = historyForRequest.reduce(
        (total, turn) => total + turn.content.length,
        0,
      )
      console.info(
        '[TOKEN_BASELINE][CHAT_HISTORY]',
        `frontend_messages=${baselineHistoryForRequest.length}`,
        `frontend_history_chars=${baselineHistoryChars}`,
        `frontend_history_tokens~=${approxTokens(baselineHistoryForRequest.map((turn) => turn.content).join(''))}`,
        `frontend_user_msg_chars=${cleanMessage.length}`,
        `frontend_user_msg_tokens~=${approxTokens(cleanMessage)}`,
      )
      console.info(
        '[TOKEN_OPTIMIZED][CHAT_HISTORY]',
        `frontend_messages=${historyForRequest.length}`,
        `frontend_history_chars=${historyChars}`,
        `frontend_history_tokens~=${approxTokens(historyForRequest.map((turn) => turn.content).join(''))}`,
        `frontend_user_msg_chars=${cleanMessage.length}`,
        `frontend_user_msg_tokens~=${approxTokens(cleanMessage)}`,
        `frontend_reduced_chars=${Math.max(0, baselineHistoryChars - historyChars)}`,
        `frontend_reduced_tokens~=${Math.max(
          0,
          approxTokens(baselineHistoryForRequest.map((turn) => turn.content).join('')) -
            approxTokens(historyForRequest.map((turn) => turn.content).join('')),
        )}`,
      )

      setQuestion('')
      setIsChatting(true)
      setConversation(loadingConversation)
      upsertChatSession(sessionId, loadingConversation, cleanMessage)

      let assistantText = ''
      let receivedFirstToken = false
      let rewriting = false

      try {
        const response = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mensaje: cleanMessage,
            historial: historyForRequest,
            modo_lectura_facil: easyReadRef.current,
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error('No se pudo iniciar el chat.')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf('\n\n')

          while (boundary !== -1) {
            const eventText = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = parseSseEvent(eventText)

            if (data === '[DONE]') {
              const finalAssistantText = assistantText || 'No se recibió respuesta.'
              const finalConversation = [
                ...baseConversation,
                userMessage,
                { role: 'assistant' as const, content: finalAssistantText },
              ]
              setConversation(finalConversation)
              upsertChatSession(sessionId, finalConversation, cleanMessage)
              if (options?.speakResponse) speakAssistant(finalAssistantText)
              setIsChatting(false)
              return
            }

            if (data.startsWith('[ERROR]')) {
              throw new Error(data)
            }

            // El backend envia [[REWRITE]] antes del texto final corregido
            // por el modo seguro: limpia y reemplaza lo acumulado.
            if (data === '[[REWRITE]]') {
              rewriting = true
              assistantText = ''
              setConversation([
                ...baseConversation,
                userMessage,
                { role: 'assistant' as const, content: '' },
              ])
              boundary = buffer.indexOf('\n\n')
              continue
            }

            // Los heartbeats SSE (`: heartbeat`) llegan como eventos sin
            // lineas `data:`, asi que parseSseEvent devuelve "". Los
            // descartamos para no llenar el chat de strings vacios.
            if (!data) {
              boundary = buffer.indexOf('\n\n')
              continue
            }

            if (!receivedFirstToken) {
              receivedFirstToken = true
              assistantText = ''
            }

            assistantText += data
            if (rewriting) {
              // Si estamos en modo rewrite, marcamos para que el debug sea
              // visible en logs; el render usa assistantText igual.
            }
            setConversation([
              ...baseConversation,
              userMessage,
              { role: 'assistant' as const, content: assistantText },
            ])
            boundary = buffer.indexOf('\n\n')
          }
        }

        const finalAssistantText = assistantText || 'No se recibió respuesta.'
        const finalConversation = [
          ...baseConversation,
          userMessage,
          { role: 'assistant' as const, content: finalAssistantText },
        ]
        setConversation(finalConversation)
        upsertChatSession(sessionId, finalConversation, cleanMessage)
        if (options?.speakResponse) speakAssistant(finalAssistantText)
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Error en el chat.'
        const errorConversation = [
          ...baseConversation,
          userMessage,
          { role: 'assistant' as const, content: messageText },
        ]
        setConversation(errorConversation)
        upsertChatSession(sessionId, errorConversation, cleanMessage)
      } finally {
        setIsChatting(false)
      }
    },
    [activeChatId, captureImportantDates, conversation, isChatting, speakAssistant, upsertChatSession],
  )

  const askQuestion = useCallback(() => {
    void streamChat(question, { speakResponse: autoSpeak })
  }, [autoSpeak, question, streamChat])

  const stopChatVoiceAnalyser = useCallback(() => {
    if (chatVoiceAnalyserFrameRef.current) {
      window.cancelAnimationFrame(chatVoiceAnalyserFrameRef.current)
      chatVoiceAnalyserFrameRef.current = null
    }
    void chatVoiceAudioContextRef.current?.close().catch(() => undefined)
    chatVoiceAudioContextRef.current = null
  }, [])

  const stopChatVoiceStream = useCallback(() => {
    chatVoiceStreamRef.current?.getTracks().forEach((track) => track.stop())
    chatVoiceStreamRef.current = null
  }, [])

  const finishChatVoiceRecording = useCallback(
    async (mimeType: string) => {
      stopChatVoiceAnalyser()
      stopChatVoiceStream()
      setIsListening(false)
      beepListenStop()

      const blob = new Blob(chatVoiceChunksRef.current, { type: mimeType || 'audio/webm' })
      chatVoiceChunksRef.current = []

      if (!chatVoiceDetectedSpeechRef.current) {
        setVoiceStatus('No se detectó voz clara. Acércate más al micrófono e intenta de nuevo.')
        beepError()
        return
      }

      if (!blob.size) {
        setVoiceStatus('No se capturó audio del micrófono.')
        beepError()
        return
      }

      const extension = extensionForMimeType(blob.type)
      const file = new File([blob], `mensaje-chat.${extension}`, {
        type: blob.type,
        lastModified: Date.now(),
      })
      const form = new FormData()
      form.append('audio', file)

      setIsTranscribingVoice(true)
      setVoiceStatus('Transcribiendo tu mensaje con Whisper local...')

      try {
        const response = await fetch('/transcribir-chat', { method: 'POST', body: form })
        const data = await readJsonResponse(response, 'No se pudo transcribir el mensaje de voz')
        if (!Boolean(data.ok)) {
          throw new Error(
            typeof data.error === 'string'
              ? data.error
              : 'No se pudo transcribir el mensaje de voz.',
          )
        }

        const transcript = String(data.texto || '').trim()
        if (!transcript) throw new Error('No se detectó voz clara en el audio.')

        setLastVoiceTranscript(transcript)

        // Antes de enviar al LLM, intentamos interpretar la frase como un
        // comando de navegacion. Esto permite "lee el resumen", "para",
        // "abre grabaciones" sin gastar al modelo y sin tocar el raton.
        const command = detectVoiceCommand(transcript)
        if (command) {
          setVoiceStatus(`Comando: ${command.type}`)
          runVoiceCommand(command)
          return
        }

        setVoiceStatus(`Entendí: "${transcript}". Generando respuesta...`)
        await streamChat(transcript, { speakResponse: autoSpeak })
      } catch (error) {
        beepError()
        setVoiceStatus(apiErrorMessage('Error al procesar la voz', error))
      } finally {
        setIsTranscribingVoice(false)
      }
    },
    [autoSpeak, runVoiceCommand, stopChatVoiceAnalyser, stopChatVoiceStream, streamChat],
  )

  const stopVoiceChat = useCallback(() => {
    const recorder = chatVoiceRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      setVoiceStatus('Procesando audio...')
      return
    }

    stopChatVoiceAnalyser()
    stopChatVoiceStream()
    setIsListening(false)
  }, [stopChatVoiceAnalyser, stopChatVoiceStream])

  const startVoiceChat = useCallback(async () => {
    if (!voiceChatSupported) {
      setVoiceStatus('Este navegador no permite capturar audio desde la página.')
      return
    }
    if (isChatting || isTranscribingVoice) {
      setVoiceStatus('Espera a que termine el turno actual.')
      return
    }

    stopSpeaking()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(),
      })
      // Refrescamos la lista de microfonos: solo despues del primer getUserMedia
      // el navegador expone los labels reales (sin permiso vienen vacios).
      void refreshMicrophones()
      const mimeType = getRecordingMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      chatVoiceStreamRef.current = stream
      chatVoiceRecorderRef.current = recorder
      chatVoiceChunksRef.current = []
      chatVoiceDetectedSpeechRef.current = false
      chatVoiceStartedAtRef.current = Date.now()
      chatVoiceLastSignalAtRef.current = Date.now()
      chatVoiceNoiseFloorRef.current = VOICE_CHAT_RMS_THRESHOLD
      chatVoiceNoiseSamplesRef.current = []

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size > 0) chatVoiceChunksRef.current.push(event.data)
      })

      recorder.addEventListener('stop', () => {
        void finishChatVoiceRecording(recorder.mimeType || mimeType)
      })

      recorder.start()
      setIsListening(true)
      setLastVoiceTranscript('')
      beepListenStart()
      setVoiceStatus('Escuchando... habla con voz clara. Pausaré al detectar silencio.')

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      const source = audioContext.createMediaStreamSource(stream)
      const samples = new Uint8Array(analyser.fftSize)
      source.connect(analyser)
      chatVoiceAudioContextRef.current = audioContext

      const monitorVoice = () => {
        if (!chatVoiceRecorderRef.current || chatVoiceRecorderRef.current.state === 'inactive') return

        const now = Date.now()
        analyser.getByteTimeDomainData(samples)
        const rms = rmsFromTimeDomain(samples)
        const elapsed = now - chatVoiceStartedAtRef.current

        // Durante los primeros milisegundos, calibramos el piso de ruido
        // ambiental. Asi el umbral se adapta a microfonos ruidosos o ambientes
        // silenciosos sin que el usuario tenga que tocar nada.
        if (elapsed < VOICE_CHAT_NOISE_CALIBRATION_MS) {
          chatVoiceNoiseSamplesRef.current.push(rms)
        } else if (chatVoiceNoiseSamplesRef.current.length > 0) {
          const noiseSamples = chatVoiceNoiseSamplesRef.current
          const avgNoise = noiseSamples.reduce((a, b) => a + b, 0) / noiseSamples.length
          chatVoiceNoiseFloorRef.current = Math.max(
            VOICE_CHAT_RMS_THRESHOLD,
            avgNoise + VOICE_CHAT_NOISE_MARGIN,
          )
          chatVoiceNoiseSamplesRef.current = []
        }

        if (rms > chatVoiceNoiseFloorRef.current) {
          chatVoiceDetectedSpeechRef.current = true
          chatVoiceLastSignalAtRef.current = now
        }

        const silenceMs = now - chatVoiceLastSignalAtRef.current
        const heardSpeech = chatVoiceDetectedSpeechRef.current

        if (heardSpeech && elapsed > VOICE_CHAT_MIN_MS && silenceMs > VOICE_CHAT_SILENCE_MS) {
          stopVoiceChat()
          return
        }
        if (!heardSpeech && elapsed > VOICE_CHAT_NO_SPEECH_MS) {
          stopVoiceChat()
          return
        }
        if (elapsed > VOICE_CHAT_MAX_MS) {
          stopVoiceChat()
          return
        }

        chatVoiceAnalyserFrameRef.current = window.requestAnimationFrame(monitorVoice)
      }

      chatVoiceAnalyserFrameRef.current = window.requestAnimationFrame(monitorVoice)
    } catch {
      stopChatVoiceAnalyser()
      stopChatVoiceStream()
      setIsListening(false)
      beepError()
      setVoiceStatus('No se pudo acceder al micrófono. Revisa los permisos del navegador.')
    }
  }, [
    buildAudioConstraints,
    finishChatVoiceRecording,
    isChatting,
    isTranscribingVoice,
    refreshMicrophones,
    stopChatVoiceAnalyser,
    stopChatVoiceStream,
    stopSpeaking,
    stopVoiceChat,
    voiceChatSupported,
  ])

  useEffect(() => {
    startVoiceChatRef.current = startVoiceChat
  }, [startVoiceChat])

  // Barge-in: durante TTS escuchamos pasivamente el microfono. Si la senal
  // pasa el umbral (BARGE_IN_RMS_THRESHOLD) durante varios frames seguidos,
  // cancelamos la voz y abrimos la grabacion para conversacion natural.
  const startBargeInListener = useCallback(async () => {
    if (!bargeInRef.current || !voiceChatSupported) return
    try {
      const deviceId = selectedMicrophoneIdRef.current
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      })
      bargeInStreamRef.current = stream
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      bargeInContextRef.current = ctx
      const samples = new Uint8Array(analyser.fftSize)
      let consecutiveHits = 0

      const monitor = () => {
        if (!bargeInContextRef.current) return
        analyser.getByteTimeDomainData(samples)
        const rms = rmsFromTimeDomain(samples)
        if (rms > BARGE_IN_RMS_THRESHOLD) {
          consecutiveHits += 1
          if (consecutiveHits >= BARGE_IN_HITS_REQUIRED) {
            // Detectada voz del usuario sobre el TTS: callamos la sintesis,
            // cerramos el listener pasivo y abrimos el microfono activo.
            window.speechSynthesis.cancel()
            stopBargeInListener()
            setVoiceStatus('Te escucho. Habla...')
            void startVoiceChatRef.current?.()
            return
          }
        } else {
          consecutiveHits = 0
        }
        bargeInFrameRef.current = window.requestAnimationFrame(monitor)
      }
      bargeInFrameRef.current = window.requestAnimationFrame(monitor)
    } catch {
      stopBargeInListener()
    }
  }, [stopBargeInListener, voiceChatSupported])

  useEffect(() => {
    startBargeInListenerRef.current = startBargeInListener
    stopBargeInListenerRef.current = stopBargeInListener
  }, [startBargeInListener, stopBargeInListener])

  const toggleVoiceChat = useCallback(() => {
    if (isListening) {
      stopVoiceChat()
      return
    }
    void startVoiceChat()
  }, [isListening, startVoiceChat, stopVoiceChat])

  // Atajo de teclado global: barra espaciadora para activar/detener la voz.
  // Imprescindible para accesibilidad: la persona ciega no necesita encontrar
  // un boton concreto en pantalla.
  useEffect(() => {
    if (!voiceChatSupported) return

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      // No interceptar si el usuario esta escribiendo en un input/textarea/contentEditable.
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }
      event.preventDefault()
      if (isChatting || isTranscribingVoice) return
      toggleVoiceChat()
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [isChatting, isTranscribingVoice, toggleVoiceChat, voiceChatSupported])

  const openFilePicker = useCallback(() => {
    audioInputRef.current?.click()
  }, [])

  const uploadSelected = Boolean(fileRef.current)

  return {
    audioInputRef,
    ollamaOk,
    modelOk,
    modelName,
    chunkCount,
    workEnabled,
    fileMeta,
    indexBtnDisabled,
    isWorking,
    uploadMessage,
    preview,
    isDragOver,
    setIsDragOver,
    uploadSelected,
    recordingTime,
    recordingUrl,
    liveCaption,
    isRecording,
    isPaused,
    markers,
    startRecording,
    pauseRecording,
    stopRecording,
    addMarker,
    summaryOutput,
    summaryGenerating,
    mapGenerating,
    mapMarkdown,
    question,
    setQuestion,
    chatSessions,
    activeChatId,
    conversation,
    importantDates,
    isChatting,
    voiceChatSupported,
    speechSupported,
    autoSpeak,
    setAutoSpeak,
    continuousVoice,
    toggleContinuousVoice,
    isListening,
    isTranscribingVoice,
    isSpeaking,
    voiceStatus,
    lastVoiceTranscript,
    microphones,
    selectedMicrophoneId,
    selectMicrophone,
    refreshMicrophones,
    ttsRate,
    setTtsRate,
    ttsVoiceUri,
    setTtsVoiceUri,
    availableVoices,
    easyRead,
    setEasyRead,
    bargeInEnabled,
    setBargeIn,
    toggleVoiceChat,
    startVoiceChat,
    stopVoiceChat,
    speakLastAssistant,
    describeMindMap,
    registerNavigationHandler,
    runVoiceCommand,
    stopSpeaking,
    resetConversation,
    openChatSession,
    handleFiles,
    indexAudio,
    generateSummary,
    generateMap,
    askQuestion,
    openFilePicker,
  }
}

export type MinuteroController = ReturnType<typeof useMinutero>
