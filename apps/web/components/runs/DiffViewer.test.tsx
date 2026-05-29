import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiffViewer } from './DiffViewer'

describe('DiffViewer', () => {
  it('renders without crashing for normal diff', () => {
    render(
      <DiffViewer
        oldContent="const x = 1\n"
        newContent="const x = 2\n"
        filename="src/foo.ts"
      />
    )
    expect(document.querySelector('table, [class*="diff"]')).toBeTruthy()
  })

  it('renders without crashing for empty old content (new file)', () => {
    render(
      <DiffViewer oldContent="" newContent="const x = 1\n" filename="src/new.ts" />
    )
    expect(document.querySelector('table, [class*="diff"]')).toBeTruthy()
  })

  it('renders without crashing for empty new content (deleted file)', () => {
    render(
      <DiffViewer oldContent="const x = 1\n" newContent="" filename="src/gone.ts" />
    )
    expect(document.querySelector('table, [class*="diff"]')).toBeTruthy()
  })

  it('shows a placeholder for binary files', () => {
    const binaryContent = '\x00\x01\x02binary'
    render(
      <DiffViewer oldContent={binaryContent} newContent={binaryContent} filename="image.png" />
    )
    expect(screen.getByText(/binary file/i)).toBeTruthy()
  })
})
