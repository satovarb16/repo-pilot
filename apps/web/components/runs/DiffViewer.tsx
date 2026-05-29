'use client'

import ReactDiffViewer from 'react-diff-viewer-continued'

interface DiffViewerProps {
  oldContent: string
  newContent: string
  filename: string
}

function isBinary(content: string): boolean {
  return /[\x00-\x08\x0e-\x1f]/.test(content)
}

export function DiffViewer({ oldContent, newContent, filename }: DiffViewerProps) {
  if (isBinary(oldContent) || isBinary(newContent)) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Binary file — diff not available for {filename}
      </div>
    )
  }

  return (
    <div className="text-xs font-mono overflow-auto">
      <ReactDiffViewer
        oldValue={oldContent}
        newValue={newContent}
        splitView={false}
        useDarkTheme
        hideLineNumbers={false}
      />
    </div>
  )
}
