import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { checkSyntax } from '../api.js'

const DEBOUNCE_MS = 500
const MARKER_OWNER = 'python-syntax'

export default function CodeEditor({ value, onChange, readOnly, filename = 'solution.py' }) {
  const [syntaxError, setSyntaxError] = useState(null)
  const monacoRef = useRef(null)
  const editorRef = useRef(null)
  const debounceRef = useRef(null)

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Live syntax check, debounced — like a real IDE's red squiggles, so a
  // stray typo gets caught while there's still time left, instead of only
  // surfacing as a silent 0 after the timer forces submission.
  useEffect(() => {
    if (readOnly) return undefined
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      checkSyntax(value)
        .then((res) => setSyntaxError(res.ok ? null : res))
        .catch(() => setSyntaxError(null)) // check endpoint unreachable — don't block editing
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [value, readOnly])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const model = editor.getModel()
    if (!model) return
    if (!syntaxError) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
      return
    }
    const line = Math.max(1, Math.min(syntaxError.line, model.getLineCount()))
    const lineContent = model.getLineContent(line) || ''
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [
      {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: Math.max(2, lineContent.length + 1),
        message: syntaxError.message,
        severity: monaco.MarkerSeverity.Error,
      },
    ])
  }, [syntaxError])

  return (
    <div className="editor-shell">
      <div className="editor-titlebar">
        <span className="editor-filename">{filename}</span>
      </div>
      <Editor
        height="480px"
        defaultLanguage="python"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          readOnly,
          fontSize: 14,
          minimap: { enabled: true },
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'all',
          cursorBlinking: 'smooth',
        }}
      />
      <div className={`syntax-status${syntaxError ? ' syntax-status-error' : ' syntax-status-ok'}`}>
        {syntaxError ? `Line ${syntaxError.line}: ${syntaxError.message}` : 'No syntax errors'}
      </div>
    </div>
  )
}
