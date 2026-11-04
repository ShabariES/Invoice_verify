import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type Props = { fileUrl: string }

export default function PdfPreview({ fileUrl }: Props) {
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError] = useState('')
  const [fileReady, setFileReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pageWidth, setPageWidth] = useState(640)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setPageWidth(Math.max(320, Math.floor(entry.contentRect.width - 28))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [pageNumber, fileUrl])

  useEffect(() => {
    let cancelled = false
    setError('')
    setFileReady(false)
    setPageCount(0)
    setPageNumber(1)
    fetch(fileUrl, { credentials: 'include' })
      .then(response => {
        if (!response.ok) throw new Error(response.status === 404 ? 'The original invoice file is missing from storage.' : `The invoice file could not be loaded (HTTP ${response.status}).`)
        return response.blob()
      })
      .then(blob => {
        if (!cancelled) {
          setFileUrlObject(URL.createObjectURL(blob))
          setFileReady(true)
        }
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'The invoice file could not be loaded.')
      })
    return () => { cancelled = true }
  }, [fileUrl])

  const [fileUrlObject, setFileUrlObject] = useState('')
  useEffect(() => () => { if (fileUrlObject) URL.revokeObjectURL(fileUrlObject) }, [fileUrlObject])

  return <div className="pdf-preview">
    <div className="pdf-page-nav">
      <button disabled={pageNumber <= 1} onClick={() => setPageNumber(page => Math.max(1, page - 1))}>Previous</button>
      <span>Page {pageNumber} of {pageCount || '…'}</span>
      <button disabled={!pageCount || pageNumber >= pageCount} onClick={() => setPageNumber(page => Math.min(pageCount, page + 1))}>Next</button>
    </div>
    <div className="pdf-page-scroll" ref={scrollRef}>
      {error ? <div className="pdf-error" role="status"><b>Source document unavailable</b><span>{error} Re-upload the invoice to restore its preview.</span></div> : !fileReady || !fileUrlObject ? <div className="pdf-message">Loading invoice document…</div> :
        <Document file={fileUrlObject} onLoadSuccess={({ numPages }) => { setPageCount(numPages); setPageNumber(1); setError('') }} onLoadError={() => setError('The file was downloaded, but the PDF preview could not read it.')} loading={<div className="pdf-message">Loading PDF pages…</div>}>
          <Page pageNumber={pageNumber} width={pageWidth} renderTextLayer renderAnnotationLayer />
        </Document>}
    </div>
  </div>
}
