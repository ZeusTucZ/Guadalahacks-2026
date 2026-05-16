import { useCallback, useEffect, useRef, useState } from 'react'

type HistoryItem = { question: string; answer: string }

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

export function useMinutero() {
  const fileRef = useRef<File | null>(null)
  const mapOutputRef = useRef<HTMLDivElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const [ollamaOk, setOllamaOk] = useState(false)
  const [modelOk, setModelOk] = useState(false)
  const [chunkCount, setChunkCount] = useState(0)
  const [workEnabled, setWorkEnabled] = useState(false)

  const [fileMeta, setFileMeta] = useState('')
  const [indexBtnDisabled, setIndexBtnDisabled] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('Selecciona un archivo para empezar.')
  const [preview, setPreview] = useState('La vista previa de la transcripción aparecerá aquí.')
  const [isDragOver, setIsDragOver] = useState(false)

  const [summaryOutput, setSummaryOutput] = useState('')
  const [question, setQuestion] = useState('')
  const [answerOutput, setAnswerOutput] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/estado')
      const data = await res.json()
      setOllamaOk(Boolean(data.ollama))
      setModelOk(Boolean(data.modelo))
      setChunkCount(Number(data.chunks_indexados) || 0)
      setWorkEnabled(Number(data.chunks_indexados) > 0)
    } catch {
      setOllamaOk(false)
      setModelOk(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

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
      await refreshStatus()
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Error al indexar.')
      setIndexBtnDisabled(false)
    } finally {
      setIsWorking(false)
    }
  }, [refreshStatus])

  const renderMindMap = useCallback((markdown: string) => {
    const el = mapOutputRef.current
    if (!el) return

    const lines = markdown
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const root = document.createElement('div')
    const stack: { level: number; element: HTMLElement }[] = [{ level: 0, element: root }]

    lines.forEach((line) => {
      let level = 1
      let text = line
      let rootNode = false

      if (line.startsWith('# ')) {
        level = 1
        text = line.replace(/^#\s+/, '')
        rootNode = true
      } else if (line.startsWith('## ')) {
        level = 2
        text = line.replace(/^##\s+/, '')
      } else if (line.startsWith('- ')) {
        level = 3
        text = line.replace(/^-\s+/, '')
      } else {
        return
      }

      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop()
      }

      const parent = stack[stack.length - 1].element
      let list = parent.querySelector(':scope > ul')
      if (!list) {
        list = document.createElement('ul')
        parent.appendChild(list)
      }

      const item = document.createElement('li')
      const node = document.createElement('span')
      node.className = `node${rootNode ? ' root' : ''}`
      node.textContent = text
      item.appendChild(node)
      list.appendChild(item)
      stack.push({ level, element: item })
    })

    el.textContent = ''
    el.appendChild(root)
  }, [])

  const streamTo = useCallback(
    (
      url: string,
      onToken: (token: string, full: string) => void,
      onDone?: (full: string) => void,
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
          full += event.data
          onToken(event.data, full)
          es.close()
          return
        }
        full += event.data
        onToken(event.data, full)
      }
      es.onerror = () => {
        es.close()
      }
    },
    [],
  )

  const generateSummary = useCallback(() => {
    setSummaryOutput('')
    streamTo('/resumir', (_token, full) => setSummaryOutput(full))
  }, [streamTo])

  const generateMap = useCallback(() => {
    const el = mapOutputRef.current
    if (el) el.textContent = ''
    streamTo('/mapa', () => undefined, (full) => renderMindMap(full))
  }, [streamTo, renderMindMap])

  const addHistory = useCallback((q: string, answer: string) => {
    setHistory((prev) => [{ question: q, answer }, ...prev].slice(0, 3))
  }, [])

  const askQuestion = useCallback(() => {
    const q = question.trim()
    if (!q) return
    setQuestion('')
    setAnswerOutput('')
    streamTo(
      `/preguntar?q=${encodeURIComponent(q)}`,
      (_token, full) => setAnswerOutput(full),
      (answer) => addHistory(q, answer),
    )
  }, [question, streamTo, addHistory])

  const openFilePicker = useCallback(() => {
    audioInputRef.current?.click()
  }, [])

  return {
    audioInputRef,
    mapOutputRef,
    ollamaOk,
    modelOk,
    chunkCount,
    workEnabled,
    fileMeta,
    indexBtnDisabled,
    isWorking,
    uploadMessage,
    preview,
    isDragOver,
    setIsDragOver,
    summaryOutput,
    question,
    setQuestion,
    answerOutput,
    history,
    handleFiles,
    indexAudio,
    generateSummary,
    generateMap,
    askQuestion,
    openFilePicker,
  }
}
