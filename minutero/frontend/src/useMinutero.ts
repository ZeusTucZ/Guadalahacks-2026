import { useCallback, useEffect, useRef, useState } from 'react'

type ChatRole = 'user' | 'assistant'
export type ChatMessage = { role: ChatRole; content: string }

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

  const [ollamaOk, setOllamaOk] = useState(false)
  const [modelOk, setModelOk] = useState(false)
  const [modelName, setModelName] = useState('')
  const [chunkCount, setChunkCount] = useState(0)
  const [workEnabled, setWorkEnabled] = useState(false)

  const [fileMeta, setFileMeta] = useState('')
  const [indexBtnDisabled, setIndexBtnDisabled] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('Selecciona un archivo para empezar.')
  const [preview, setPreview] = useState('La vista previa de la transcripción aparecerá aquí.')
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
  const [conversation, setConversation] = useState<ChatMessage[]>([])
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

  const resetConversation = useCallback(() => {
    setConversation([])
  }, [])

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
  }, [refreshStatus, resetConversation])

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
      () => setSummaryGenerating(false),
      (message) => {
        setSummaryOutput(message)
        setSummaryGenerating(false)
      },
    )
  }, [streamTo])

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

      const historyForRequest = conversation.slice(-8).map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, 1200),
      }))

      setQuestion('')
      setIsChatting(true)
      setConversation((prev) => [
        ...prev,
        { role: 'user', content: cleanMessage },
        { role: 'assistant', content: 'Cargando modelo local...' },
      ])

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
              setConversation((prev) => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: assistantText || 'No se recibió respuesta.' },
              ])
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
            setConversation((prev) => [
              ...prev.slice(0, -1),
              { role: 'assistant', content: assistantText },
            ])
            boundary = buffer.indexOf('\n\n')
          }
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Error en el chat.'
        setConversation((prev) => [...prev.slice(0, -1), { role: 'assistant', content: messageText }])
      } finally {
        setIsChatting(false)
      }
    },
    [conversation, isChatting],
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
    conversation,
    isChatting,
    resetConversation,
    handleFiles,
    indexAudio,
    generateSummary,
    generateMap,
    askQuestion,
    openFilePicker,
  }
}

export type MinuteroController = ReturnType<typeof useMinutero>
