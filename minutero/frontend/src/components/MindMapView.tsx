type MindMapNode = {
  text: string
  root?: boolean
  children: MindMapNode[]
}

function parseMindMap(markdown: string) {
  const root: MindMapNode = { text: '', children: [] }
  const stack: { level: number; node: MindMapNode }[] = [{ level: 0, node: root }]

  markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
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

      const node: MindMapNode = { text, root: rootNode, children: [] }
      stack[stack.length - 1].node.children.push(node)
      stack.push({ level, node })
    })

  return root.children
}

function MindMapBranch({ nodes }: { nodes: MindMapNode[] }) {
  if (!nodes.length) return null

  return (
    <ul>
      {nodes.map((node, index) => (
        <li key={`${node.text}-${index}`}>
          <span className={`node${node.root ? ' root' : ''}`}>{node.text}</span>
          <MindMapBranch nodes={node.children} />
        </li>
      ))}
    </ul>
  )
}

export function MindMapView({
  markdown,
  loading,
}: {
  markdown: string
  loading?: boolean
}) {
  if (loading) {
    return <span className="text-zinc-600">Cargando modelo local...</span>
  }

  if (!markdown.trim()) {
    return <span className="text-zinc-600">El mapa mental aparecerá aquí.</span>
  }

  return (
    <div className="mindmap">
      <MindMapBranch nodes={parseMindMap(markdown)} />
    </div>
  )
}
