import Editor from '@monaco-editor/react'

export default function CodeEditor({ value, onChange, readOnly }) {
  return (
    <div className="editor-shell">
      <div className="editor-titlebar">
        <span className="editor-dot editor-dot-red" />
        <span className="editor-dot editor-dot-yellow" />
        <span className="editor-dot editor-dot-green" />
        <span className="editor-filename">solution.py</span>
      </div>
      <Editor
        height="480px"
        defaultLanguage="python"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? '')}
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
    </div>
  )
}
