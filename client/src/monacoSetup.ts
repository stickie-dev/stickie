import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}

// single files reviewed in isolation would otherwise be full of
// missing-import squiggles
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
})
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
})

// modern, low-saturation themes aligned with the app's surface tokens;
// stock vs/vs-dark plus default diff colors read a decade old
monaco.editor.defineTheme('stickie-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cf222e' },
    { token: 'string', foreground: '0a3069' },
    { token: 'number', foreground: '0550ae' },
    { token: 'type', foreground: '953800' },
    { token: 'identifier', foreground: '1f2328' },
    { token: 'delimiter', foreground: '57606a' },
    { token: 'tag', foreground: '116329' },
    { token: 'attribute.name', foreground: '0550ae' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2328',
    'editorLineNumber.foreground': '#b0b3ba',
    'editorLineNumber.activeForeground': '#57606a',
    'editorGutter.background': '#ffffff',
    'editor.selectionBackground': '#b6d7ff66',
    'editor.inactiveSelectionBackground': '#b6d7ff33',
    'editorIndentGuide.background1': '#f0f1f3',
    'editorIndentGuide.activeBackground1': '#d8dbe0',
    'diffEditor.insertedLineBackground': '#e0f7e6',
    'diffEditor.insertedTextBackground': '#84e09a80',
    'diffEditor.removedLineBackground': '#ffe9e7',
    'diffEditor.removedTextBackground': '#ff9a9466',
    'diffEditorGutter.insertedLineBackground': '#c3ecd0',
    'diffEditorGutter.removedLineBackground': '#ffd4d1',
    'diffEditor.diagonalFill': '#00000010',
    'diffEditor.unchangedRegionBackground': '#f6f8fa',
    'diffEditor.unchangedRegionForeground': '#57606a',
    'editorRuler.foreground': '#d8dee4',
    'scrollbarSlider.background': '#8c959f33',
    'scrollbarSlider.hoverBackground': '#8c959f55',
    'scrollbarSlider.activeBackground': '#8c959f77',
    'editorOverviewRuler.border': '#ffffff00',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d4d4d8',
  },
})

monaco.editor.defineTheme('stickie-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'identifier', foreground: 'e6edf3' },
    { token: 'delimiter', foreground: '8b949e' },
    { token: 'tag', foreground: '7ee787' },
    { token: 'attribute.name', foreground: '79c0ff' },
  ],
  colors: {
    'editor.background': '#18181b',
    'editor.foreground': '#e6edf3',
    'editorLineNumber.foreground': '#4b4b53',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editorGutter.background': '#18181b',
    'editor.selectionBackground': '#3b507080',
    'editor.inactiveSelectionBackground': '#3b507040',
    'editorIndentGuide.background1': '#232327',
    'editorIndentGuide.activeBackground1': '#3f3f46',
    'diffEditor.insertedLineBackground': '#1d572b55',
    'diffEditor.insertedTextBackground': '#2ea04366',
    'diffEditor.removedLineBackground': '#7d2e2855',
    'diffEditor.removedTextBackground': '#f8514955',
    'diffEditorGutter.insertedLineBackground': '#23863960',
    'diffEditorGutter.removedLineBackground': '#da363360',
    'diffEditor.diagonalFill': '#ffffff0d',
    'diffEditor.unchangedRegionBackground': '#1f1f23',
    'diffEditor.unchangedRegionForeground': '#a1a1aa',
    'editorRuler.foreground': '#2b3038',
    'scrollbarSlider.background': '#6e768133',
    'scrollbarSlider.hoverBackground': '#6e768155',
    'scrollbarSlider.activeBackground': '#6e768177',
    'editorOverviewRuler.border': '#18181b00',
    'editorWidget.background': '#202024',
    'editorWidget.border': '#3f3f46',
  },
})

export const editor_font =
  '"SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, "DejaVu Sans Mono", monospace'

loader.config({ monaco })

export { monaco }
