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
const DEFAULT_TRANSCRIPT_PREVIEW = 'La vista previa de la transcripción aparecerá aquí.'
const MAX_CHAT_SESSIONS = 24
const MAX_CHAT_MESSAGES = 80

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`
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
    desc: 'Detectada en Minutero',
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

export function useMinutero() {
  const fileRef = useRef<File | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<BlobPart[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingUrlRef = useRef<string | null>(null)
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

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/estado')
      const data = await res.json()
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
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
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
    [selectFile, stopMediaStream, stopRecordingTimer],
  )

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setUploadMessage('Este navegador no permite grabar audio desde la página.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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

      recorder.start()
      setIsRecording(true)
      setIsPaused(false)
      setMarkers([])
      setUploadMessage('Grabando localmente desde el navegador.')
      startRecordingTimer()
    } catch {
      setIsRecording(false)
      setIsPaused(false)
      stopRecordingTimer()
      stopMediaStream()
      setUploadMessage('No se pudo acceder al micrófono.')
    }
  }, [finishRecording, startRecordingTimer, stopMediaStream, stopRecordingTimer])

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return

    if (recorder.state === 'recording') {
      recorder.pause()
      setIsPaused(true)
      setUploadMessage('Grabación pausada.')
      stopRecordingTimer()
    } else if (recorder.state === 'paused') {
      recorder.resume()
      setIsPaused(false)
      setUploadMessage('Grabando localmente desde el navegador.')
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
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'No se pudo indexar el audio.')
      setPreview(data.preview || 'Audio procesado.')
      captureImportantDates(data.preview || '')
      setUploadMessage(`Listo. ${data.chunks} chunks indexados.`)
      setWorkEnabled(true)
      setSummaryOutput('')
      setMapMarkdown('')
      resetConversation()
      await refreshStatus()
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Error al indexar.')
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

  const streamChat = useCallback(
    async (message: string) => {
      const cleanMessage = message.trim()
      if (!cleanMessage || isChatting) return
      captureImportantDates(cleanMessage)

      const baseConversation = conversation
      const sessionId = activeChatId || createChatSessionId()
      const userMessage: ChatMessage = { role: 'user', content: cleanMessage }
      const loadingMessage: ChatMessage = { role: 'assistant', content: 'Cargando modelo local...' }
      const loadingConversation = [...baseConversation, userMessage, loadingMessage]

      if (!activeChatId) setActiveChatId(sessionId)

      const historyForRequest = baseConversation.slice(-8).map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, 1200),
      }))

      setQuestion('')
      setIsChatting(true)
      setConversation(loadingConversation)
      upsertChatSession(sessionId, loadingConversation, cleanMessage)

      let assistantText = ''
      let receivedFirstToken = false

      try {
        const response = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mensaje: cleanMessage,
            historial: historyForRequest,
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
              const finalConversation = [
                ...baseConversation,
                userMessage,
                { role: 'assistant' as const, content: assistantText || 'No se recibió respuesta.' },
              ]
              setConversation(finalConversation)
              upsertChatSession(sessionId, finalConversation, cleanMessage)
              setIsChatting(false)
              return
            }

            if (data.startsWith('[ERROR]')) {
              throw new Error(data)
            }

            if (!receivedFirstToken) {
              receivedFirstToken = true
              assistantText = ''
            }

            assistantText += data
            setConversation([
              ...baseConversation,
              userMessage,
              { role: 'assistant' as const, content: assistantText },
            ])
            boundary = buffer.indexOf('\n\n')
          }
        }

        const finalConversation = [
          ...baseConversation,
          userMessage,
          { role: 'assistant' as const, content: assistantText || 'No se recibió respuesta.' },
        ]
        setConversation(finalConversation)
        upsertChatSession(sessionId, finalConversation, cleanMessage)
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
    [activeChatId, captureImportantDates, conversation, isChatting, upsertChatSession],
  )

  const askQuestion = useCallback(() => {
    void streamChat(question)
  }, [question, streamChat])

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
