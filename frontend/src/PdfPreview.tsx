import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type Props = { fileUrl: string }

export default function PdfPreview({ fileUrl }: Props) {
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError] = useState('')

  return <div className="pdf-preview">
    <div className="pdf-page-nav">
      <button disabled={pageNumber <= 1} onClick={() => setPageNumber(page => Math.max(1, page - 1))}>Previous</button>
      <span>Page {pageNumber} of {pageCount || '…'}</span>
      <button disabled={!pageCount || pageNumber >= pageCount} onClick={() => setPageNumber(page => Math.min(pageCount, page + 1))}>Next</button>
    </div>
    <div className="pdf-page-scroll">
      {error ? <div className="pdf-error">Could not render this PDF. Use “Open original” to view it.</div> :
        <Document file={{ url: fileUrl }} options={{ withCredentials: true }} onLoadSuccess={({ numPages }) => { setPageCount(numPages); setPageNumber(1); setError('') }} onLoadError={() => setError('PDF preview unavailable')} loading={<div className="pdf-message">Loading PDF pages…</div>}>
          <Page pageNumber={pageNumber} width={380} renderTextLayer renderAnnotationLayer />
        </Document>}
    </div>
  </div>
}
