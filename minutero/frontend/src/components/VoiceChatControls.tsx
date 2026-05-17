import { useState } from 'react'
import {
  BookOpen,
  Ear,
  Gauge,
  Keyboard,
  Mic,
  MicVocal,
  Repeat,
  RotateCcw,
  Settings2,
  Square,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react'
import type { MinuteroController } from '../useMinutero'

const NETWORK_MIC_HINTS = ['iphone', 'ipad', 'continuity', 'continuidad', 'airpods']

function isNetworkMic(label: string) {
  const normalized = label.toLowerCase()
  return NETWORK_MIC_HINTS.some((hint) => normalized.includes(hint))
}

function micLabel(device: MediaDeviceInfo, index: number) {
  if (device.label) return device.label
  return `Micrófono ${index + 1}`
}

export function VoiceChatControls({ minutero: m }: { minutero: MinuteroController }) {
  const [showSettings, setShowSettings] = useState(false)
  const hasAssistantMessage = m.conversation.some((message) => message.role === 'assistant')
  const captureDisabled =
    !m.voiceChatSupported || m.isChatting || m.isTranscribingVoice || !m.workEnabled
  const speechDisabled = !m.speechSupported || !m.workEnabled
  const status = !m.voiceChatSupported
    ? 'Micrófono no disponible en este navegador.'
    : !m.speechSupported
      ? 'Salida de voz no disponible en este navegador.'
      : m.voiceStatus

  const selectedMicrophone = m.microphones.find(
    (device) => device.deviceId === m.selectedMicrophoneId,
  )
  const selectedNeedsNetwork = selectedMicrophone && isNetworkMic(selectedMicrophone.label)

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
      aria-label="Controles de conversación por voz"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={m.toggleVoiceChat}
            disabled={captureDisabled && !m.isListening}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
              m.isListening
                ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/20'
                : 'bg-[#c7b8ea] text-zinc-950 hover:bg-[#d4c8f0]'
            }`}
            aria-label={
              m.isListening
                ? 'Detener mensaje de voz. Atajo: barra espaciadora'
                : 'Dictar mensaje de voz. Atajo: barra espaciadora'
            }
            aria-pressed={m.isListening}
          >
            {m.isListening ? (
              <Square className="h-4 w-4" fill="currentColor" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {m.isListening
              ? 'Detener'
              : m.isTranscribingVoice
                ? 'Transcribiendo'
                : 'Hablar (Espacio)'}
          </button>

          <button
            type="button"
            onClick={() => m.setAutoSpeak((enabled) => !enabled)}
            disabled={speechDisabled}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
              m.autoSpeak
                ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
            aria-pressed={m.autoSpeak}
            aria-label="Alternar respuesta hablada"
          >
            {m.autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            Respuesta por voz
          </button>

          <button
            type="button"
            onClick={m.toggleContinuousVoice}
            disabled={!m.voiceChatSupported || !m.speechSupported || !m.workEnabled}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
              m.continuousVoice
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
            aria-pressed={m.continuousVoice}
            aria-label="Alternar conversación continua: el micrófono se reabre tras cada respuesta"
          >
            <Repeat className="h-4 w-4" />
            Conversación continua
          </button>

          <button
            type="button"
            onClick={m.isSpeaking ? m.stopSpeaking : m.speakLastAssistant}
            disabled={speechDisabled || (!m.isSpeaking && !hasAssistantMessage)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={m.isSpeaking ? 'Detener audio de respuesta' : 'Leer última respuesta'}
          >
            {m.isSpeaking ? <VolumeX className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            {m.isSpeaking ? 'Silenciar' : 'Repetir'}
          </button>

          <button
            type="button"
            onClick={m.describeMindMap}
            disabled={speechDisabled}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Describir el mapa mental con voz"
          >
            <BookOpen className="h-4 w-4" />
            Describir mapa
          </button>

          <button
            type="button"
            onClick={() => setShowSettings((show) => !show)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              showSettings
                ? 'border-[#c7b8ea]/40 bg-[#c7b8ea]/10 text-[#c7b8ea]'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
            aria-expanded={showSettings}
            aria-controls="voice-settings-panel"
            aria-label="Mostrar ajustes de accesibilidad"
          >
            <Settings2 className="h-4 w-4" />
            Ajustes
          </button>
        </div>

        <div
          className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 sm:ml-auto"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {(m.isListening || m.isTranscribingVoice || m.isSpeaking) && (
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                m.isListening ? 'bg-red-400' : 'bg-teal-400'
              } animate-pulse`}
              aria-hidden
            />
          )}
          <span className="truncate">{status}</span>
        </div>
      </div>

      {m.voiceChatSupported && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label
            htmlFor="microphone-select"
            className="flex shrink-0 items-center gap-2 text-xs font-medium text-zinc-400"
          >
            <MicVocal className="h-4 w-4" />
            Micrófono:
          </label>
          <select
            id="microphone-select"
            value={m.selectedMicrophoneId ?? ''}
            onChange={(event) => m.selectMicrophone(event.target.value || null)}
            onFocus={() => void m.refreshMicrophones()}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-[#c7b8ea]/50"
            aria-label="Selecciona el micrófono que usará la app"
          >
            {m.microphones.length === 0 ? (
              <option value="">Sin micrófonos detectados — pulsa Hablar para autorizar</option>
            ) : (
              m.microphones.map((device, index) => {
                const label = micLabel(device, index)
                const needsNetwork = isNetworkMic(label)
                return (
                  <option key={device.deviceId} value={device.deviceId}>
                    {needsNetwork ? '⚠ ' : ''}
                    {label}
                    {needsNetwork ? ' (requiere Wi-Fi/Bluetooth)' : ''}
                  </option>
                )
              })
            )}
          </select>
          {selectedNeedsNetwork && (
            <span
              className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300"
              role="alert"
            >
              <Wifi className="h-3 w-3" />
              Este micrófono usa red. Elige uno local para trabajar offline.
            </span>
          )}
        </div>
      )}

      {showSettings && (
        <div
          id="voice-settings-panel"
          className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
          aria-label="Ajustes de accesibilidad y voz"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label
              htmlFor="tts-rate-slider"
              className="flex w-44 shrink-0 items-center gap-2 text-xs font-medium text-zinc-400"
            >
              <Gauge className="h-4 w-4" />
              Velocidad de voz
            </label>
            <input
              id="tts-rate-slider"
              type="range"
              min="0.5"
              max="3"
              step="0.05"
              value={m.ttsRate}
              onChange={(event) => m.setTtsRate(Number(event.target.value))}
              className="flex-1 accent-[#c7b8ea]"
              aria-valuemin={0.5}
              aria-valuemax={3}
              aria-valuenow={m.ttsRate}
              aria-valuetext={`${m.ttsRate.toFixed(2)} veces`}
            />
            <span className="w-12 shrink-0 text-right text-xs font-mono text-zinc-300">
              {m.ttsRate.toFixed(2)}x
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label
              htmlFor="tts-voice-select"
              className="flex w-44 shrink-0 items-center gap-2 text-xs font-medium text-zinc-400"
            >
              <Volume2 className="h-4 w-4" />
              Voz del asistente
            </label>
            <select
              id="tts-voice-select"
              value={m.ttsVoiceUri ?? ''}
              onChange={(event) => m.setTtsVoiceUri(event.target.value || null)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-[#c7b8ea]/50"
              aria-label="Voz usada para la respuesta hablada"
            >
              <option value="">Automática (recomendada)</option>
              {m.availableVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={m.easyRead}
              onChange={(event) => m.setEasyRead(event.target.checked)}
              className="h-4 w-4 accent-[#c7b8ea]"
            />
            <BookOpen className="h-4 w-4 text-zinc-500" />
            <span>
              <strong>Modo lectura fácil:</strong> respuestas en frases cortas y vocabulario simple
              (para dislexia, TDAH o fatiga cognitiva)
            </span>
          </label>

          <label className="flex items-center gap-3 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={m.bargeInEnabled}
              onChange={(event) => m.setBargeIn(event.target.checked)}
              className="h-4 w-4 accent-[#c7b8ea]"
            />
            <Ear className="h-4 w-4 text-zinc-500" />
            <span>
              <strong>Interrumpir al hablar (barge-in):</strong> si empiezas a hablar mientras la
              IA responde, se calla y te escucha
            </span>
          </label>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[11px] text-zinc-500">
            <p className="mb-1 flex items-center gap-1 font-semibold text-zinc-400">
              <Keyboard className="h-3 w-3" />
              Atajos y comandos
            </p>
            <p>
              <kbd className="rounded bg-zinc-800 px-1">Espacio</kbd> · iniciar/detener voz
            </p>
            <p>
              <strong>Comandos por voz:</strong> "repite", "para", "más rápido", "más despacio",
              "lee el resumen", "genera resumen", "genera mapa", "describe el mapa", "abre
              grabaciones", "abre el chat", "nuevo chat", "modo lectura fácil", "ayuda".
            </p>
          </div>
        </div>
      )}

      {m.lastVoiceTranscript && (
        <div
          className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400"
          aria-live="polite"
        >
          <span className="font-semibold text-zinc-500">Última transcripción: </span>
          <span className="text-zinc-200">{m.lastVoiceTranscript}</span>
        </div>
      )}
    </div>
  )
}
