import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronRight, Clock3, FileCheck2, FileText, LayoutDashboard, LogOut, Plus, Search, Upload, UsersRound, X } from 'lucide-react'
import PdfPreview from './PdfPreview'
import AuthScreen, { AuthUser } from './AuthScreen'
import { CrmHome, Lead, LeadsPage } from './CrmPages'
import LandingPage from './LandingPage'
import { API, apiFetch } from './api'

type Line = { description: string; quantity: number; rate: number; amount: number }
type Invoice = { id: number; invoice_number: string; invoice_date: string | null; supplier_name: string; supplier_gstin: string; currency: string; subtotal: number; tax_amount: number; total: number; source_path: string; source_name: string; status: string; reviewer: string; lines: Line[]; ocr_status: string; ocr_provider: string; ocr_confidence: number | null; ocr_text: string }
type InvoiceEvent = { id: number; invoice_id: number; event_type: string; actor: string; details: string; created_at: string }
const empty = (id: number): Invoice => ({ id, invoice_number: '', invoice_date: null, supplier_name: '', supplier_gstin: '', currency: 'INR', subtotal: 0, tax_amount: 0, total: 0, source_path: '', source_name: '', status: 'needs_review', reviewer: '', lines: [], ocr_status: 'not_run', ocr_provider: '', ocr_confidence: null, ocr_text: '' })
const fmt = (v: number, currency = 'INR') => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(Number(v || 0))
function countInvoiceMistakes(invoice: Invoice) {
  let issues = 0
  if (invoice.lines.length) {
    const lineTotal = invoice.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
    issues += invoice.lines.filter(line => Math.abs(Number(line.quantity) * Number(line.rate) - Number(line.amount)) > 0.01).length
    if (Math.abs(lineTotal - Number(invoice.subtotal || 0)) > 0.01) issues += 1
  }
  const hasAmounts = Number(invoice.subtotal) !== 0 || Number(invoice.tax_amount) !== 0 || Number(invoice.total) !== 0
  if (hasAmounts && Math.abs(Number(invoice.subtotal || 0) + Number(invoice.tax_amount || 0) - Number(invoice.total || 0)) > 0.01) issues += 1
  return issues
}

export default function App() {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authIntent, setAuthIntent] = useState<'signup' | 'signin'>('signup')
  const [activeView, setActiveView] = useState<'home' | 'leads' | 'invoices'>('home')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceEvents, setInvoiceEvents] = useState<InvoiceEvent[]>([])
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'needs_review' | 'approved' | 'mistakes'>('all')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [leadQuery, setLeadQuery] = useState('')
  const [leadFilterIntent, setLeadFilterIntent] = useState('all')
  const [createLeadRequest, setCreateLeadRequest] = useState(0)
  const [busy, setBusy] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dashboardScrollRef = useRef<HTMLDivElement>(null)
  const current = invoices.find(i => i.id === selected) || null
  const invoiceMistakes = invoices.reduce((sum, invoice) => sum + countInvoiceMistakes(invoice), 0)
  const visibleInvoices = invoices.filter(invoice => (invoiceFilter === 'all' || (invoiceFilter === 'mistakes' ? countInvoiceMistakes(invoice) > 0 : invoice.status === invoiceFilter)) && `${invoice.supplier_name} ${invoice.invoice_number} ${invoice.source_name}`.toLowerCase().includes(query.toLowerCase()))
  function applyInvoiceFilter(filter: 'all' | 'needs_review' | 'approved' | 'mistakes', explanation = '') {
    const matching = invoices.filter(invoice => (filter === 'all' || (filter === 'mistakes' ? countInvoiceMistakes(invoice) > 0 : invoice.status === filter)) && `${invoice.supplier_name} ${invoice.invoice_number} ${invoice.source_name}`.toLowerCase().includes(query.toLowerCase()))
    setInvoiceFilter(filter)
    setMessage(explanation)
    setSelected(currentId => matching.some(invoice => invoice.id === currentId) ? currentId : matching[0]?.id ?? null)
  }
  const lineSubtotal = current?.lines.length ? current.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0) : Number(current?.subtotal || 0)
  const calculatedTotal = Math.round((lineSubtotal + Number(current?.tax_amount || 0) + Number.EPSILON) * 100) / 100
  const invoiceTotalMatches = !!current && (!current.lines.length || Math.abs(lineSubtotal - Number(current.subtotal || 0)) <= 0.01) && Math.abs(calculatedTotal - Number(current.total || 0)) <= 0.01
  async function refresh(prefer?: number) {
    try {
      const res = await apiFetch(`${API}/api/invoices`)
      if (!res.ok) throw new Error('Could not load invoices')
      const data: Invoice[] = await res.json(); setInvoices(data)
      if (prefer && data.some(x => x.id === prefer)) setSelected(prefer)
      else if (!selected && data.length) setSelected(data[0].id)
    } catch { setMessage('API is unavailable. Start the FastAPI server to use the local workflow.') }
  }
  async function refreshLeads() {
    try {
      const res = await apiFetch(`${API}/api/leads`)
      if (!res.ok) throw new Error('Could not load leads')
      setLeads(await res.json())
    } catch { setLeads([]) }
  }
  useEffect(() => {
    void apiFetch(`${API}/api/auth/me`).then(response => response.ok ? response.json() : null).then((currentUser: AuthUser | null) => {
      if (currentUser) { setUser(currentUser); setWorkspaceOpen(true); setActiveView(currentUser.role === 'admin' ? 'home' : 'leads') }
    }).catch(() => undefined)
  }, [])
  useEffect(() => { if (user?.role === 'admin') void refresh(); else { setInvoices([]); setSelected(null) } }, [user])
  useEffect(() => {
    if (!selected) { setInvoiceEvents([]); return }
    apiFetch(`${API}/api/invoices/${selected}/events`).then(response => response.ok ? response.json() : []).then(setInvoiceEvents).catch(() => setInvoiceEvents([]))
  }, [selected, invoices])
  useEffect(() => { if (workspaceOpen && user) void refreshLeads() }, [workspaceOpen, user])
  useEffect(() => { if (dashboardScrollRef.current) dashboardScrollRef.current.scrollTop = 0 }, [activeView])
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(true); setMessage('Uploading invoice…')
    try {
      const body = new FormData(); body.append('file', file)
      const res = await apiFetch(`${API}/api/invoices/upload`, { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Upload failed')
      await refresh(data.id); setMessage('Invoice source saved. Enter the details after checking the document.')
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Upload failed') }
    finally { setBusy(false); e.target.value = '' }
  }
  async function runOcr() {
    if (!current) return
    setOcrBusy(true); setMessage('Reading invoice text…')
    try {
      const response = await apiFetch(`${API}/api/invoices/${current.id}/extract`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'OCR failed')
      setInvoices(rows => rows.map(invoice => invoice.id === data.invoice.id ? data.invoice : invoice))
      setMessage(data.low_confidence ? 'OCR completed with low confidence. Check every value against the source.' : 'OCR completed. Verify the extracted text and every amount against the source.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'OCR failed') }
    finally { setOcrBusy(false) }
  }
  function patchLocal(key: keyof Invoice, value: unknown) {
    if (!current) return
    setInvoices(rows => rows.map(i => i.id === current.id ? { ...i, [key]: value } : i))
  }
  async function save() {
    if (!current) return
    const payload = { invoice_number: current.invoice_number, invoice_date: current.invoice_date || null, supplier_name: current.supplier_name, supplier_gstin: current.supplier_gstin, currency: current.currency, subtotal: Number(current.subtotal), tax_amount: Number(current.tax_amount), total: Number(current.total), lines: current.lines }
    const res = await apiFetch(`${API}/api/invoices/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json(); if (!res.ok) { setMessage(typeof data.detail === 'string' ? data.detail : 'Could not save invoice'); return }
    setInvoices(rows => rows.map(i => i.id === data.id ? data : i)); setMessage('Invoice details saved.')
  }
  async function approve() {
    if (!current) return
    const saved = await apiFetch(`${API}/api/invoices/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_number: current.invoice_number, invoice_date: current.invoice_date || null, supplier_name: current.supplier_name, supplier_gstin: current.supplier_gstin, currency: current.currency, subtotal: Number(current.subtotal), tax_amount: Number(current.tax_amount), total: Number(current.total), lines: current.lines }) })
    if (!saved.ok) { const d = await saved.json(); setMessage(d.detail || 'Save invoice before approval'); return }
    const res = await apiFetch(`${API}/api/invoices/${current.id}/approve`, { method: 'POST' })
    const data = await res.json(); if (!res.ok) { setMessage(data.detail || 'Could not approve'); return }
    setInvoices(rows => rows.map(i => i.id === data.id ? data : i)); setMessage('Reviewed and approved locally. No accounting system is connected.')
  }
  async function addLine() { if (!current) return; patchLocal('lines', [...current.lines, { description: '', quantity: 1, rate: 0, amount: 0 }]) }
  if (!workspaceOpen && !authOpen) return <LandingPage onRegister={() => { setAuthIntent('signup'); setAuthOpen(true) }} onLogin={() => { setAuthIntent('signin'); setAuthOpen(true) }}/>
  if (!workspaceOpen) return <AuthScreen key={authIntent} onEnter={signedInUser => { setUser(signedInUser); setWorkspaceOpen(true); setAuthOpen(false); setActiveView(signedInUser.role === 'admin' ? 'home' : 'leads') }} onBack={() => setAuthOpen(false)} initialMode={authIntent}/>
  async function signOut() {
    await apiFetch(`${API}/api/auth/logout`, { method: 'POST' }).catch(() => undefined)
    setUser(null); setWorkspaceOpen(false); setAuthOpen(false); setInvoices([]); setLeads([]); setActiveView('home')
  }
  const openLeads = (filter = 'all') => { setLeadFilterIntent(filter); setActiveView('leads') }
  const createLead = () => { openLeads('all'); setCreateLeadRequest(count => count + 1) }
  const searchValue = activeView === 'invoices' ? query : leadQuery
  const setSearchValue = activeView === 'invoices' ? setQuery : setLeadQuery
  const pageTitle = activeView === 'home' ? 'Overview' : activeView === 'leads' ? 'Leads' : 'Invoices'
  return <div className="layout"><aside className="side"><div className="logo"><span>T</span><div><b>TECHJAYS</b><small>ACCOUNTING CRM</small></div></div><div className="nav-caption">WORKSPACE</div><button type="button" className={`nav ${activeView==='home'?'active':''}`} onClick={()=>setActiveView('home')}><LayoutDashboard size={18}/> Overview</button><button type="button" className={`nav ${activeView==='leads'?'active':''}`} onClick={()=>openLeads('all')}><UsersRound size={18}/> Leads <b>{leads.filter(lead=>!['won','lost'].includes(lead.status)).length}</b></button>{user?.role === 'admin' && <><div className="nav-caption nav-caption-secondary">ACCOUNTING</div><button type="button" className={`nav ${activeView==='invoices'?'active':''}`} onClick={()=>setActiveView('invoices')}><FileText size={18}/> Invoices <b>{invoices.filter(i=>i.status==='needs_review').length}</b></button></>}<div className="local-tag"><i/> {user?.role === 'admin' ? 'ADMIN ACCESS' : 'LEAD ACCESS'}</div><div className="side-foot">Signed in as<br/>{user?.email}</div></aside>
    <main><header><div className="crumb"><span>Workspace</span><ChevronRight size={14}/><b>{pageTitle}</b></div><label className="top-search"><Search size={17}/><input placeholder={activeView==='invoices'?'Search invoices, suppliers…':'Search leads, companies…'} value={searchValue} onChange={e=>{setSearchValue(e.target.value);if(activeView==='home'&&e.target.value)openLeads('all')}}/></label><div className="top-actions"><span className="profile-chip"><b>{(user?.name || 'U').slice(0,2).toUpperCase()}</b><span>{user?.role === 'admin' ? 'Admin' : 'Lead'}</span></span><button type="button" className="signout-button" onClick={signOut}><LogOut size={15}/> Sign out</button></div></header><div className="dashboard-scroll" ref={dashboardScrollRef}>
    {activeView === 'home' && <CrmHome leads={leads} invoiceCount={invoices.length} canViewAccounting={user?.role === 'admin'} onOpenLeads={openLeads} onOpenInvoices={()=>setActiveView('invoices')} onCreateLead={createLead}/>}
    {activeView === 'leads' && <LeadsPage isAdmin={user?.role === 'admin'} leads={leads} onLeadsChange={setLeads} createRequest={createLeadRequest} query={leadQuery} initialFilter={leadFilterIntent}/>}
    {activeView === 'invoices' && <>
    <section className="heading"><div><div className="kicker">SUPPLIER OPERATIONS</div><h1>Invoice desk</h1><p>Your review queue, all in one place.</p></div><label className="upload"><Upload size={16}/> {busy ? 'Uploading…' : 'Upload invoice'}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={upload} disabled={busy}/></label></section>
    <section className="summary" aria-label="Invoice summaries">
      <button type="button" className={invoiceFilter === 'all' ? 'selected' : ''} aria-pressed={invoiceFilter === 'all'} onClick={() => applyInvoiceFilter('all')}><span>Total invoices</span><b>{invoices.length}</b><small className="summary-note">Show every invoice</small></button>
      <button type="button" className={invoiceFilter === 'needs_review' ? 'selected' : ''} aria-pressed={invoiceFilter === 'needs_review'} onClick={() => applyInvoiceFilter('needs_review')}><span>Needs review</span><b>{invoices.filter(i=>i.status==='needs_review').length}</b><small className="summary-note">Open the review queue</small></button>
      <button type="button" className={invoiceFilter === 'approved' ? 'selected' : ''} aria-pressed={invoiceFilter === 'approved'} onClick={() => applyInvoiceFilter('approved')}><span>Approved</span><b>{invoices.filter(i=>i.status==='approved').length}</b><small className="summary-note">Show approved invoices</small></button>
      <button type="button" className="workflow-summary" onClick={() => applyInvoiceFilter('needs_review', 'Every invoice needs a named human reviewer before it can be approved. The review queue is open below.')}><span>Human approval</span><b className="safe">Required</b><small className="summary-note">Before an invoice is approved</small></button>
      <button type="button" className={invoiceFilter === 'mistakes' ? 'selected' : ''} aria-pressed={invoiceFilter === 'mistakes'} onClick={() => applyInvoiceFilter('mistakes')} title="Show invoices with amount or line calculation issues"><span>Total mistakes</span><b className={invoiceMistakes ? 'attention' : ''}>{invoiceMistakes}</b><small className="summary-note">Amount and line mismatches</small></button>
    </section>
    {message && <div className="message"><span>{message}</span><button onClick={()=>setMessage('')}><X size={15}/></button></div>}
    <section className="content"><div className="list"><div className="list-head"><div><h2>{invoiceFilter === 'all' ? 'Invoice inbox' : invoiceFilter === 'needs_review' ? 'Needs review' : invoiceFilter === 'approved' ? 'Approved invoices' : 'Invoices with mistakes'}</h2><small>{visibleInvoices.length} shown · {invoices.filter(i=>i.status==='needs_review').length} waiting for review</small></div><label className="small-upload"><Plus size={15}/> Add<input type="file" accept="application/pdf,image/*" onChange={upload}/></label></div><div className="rows">{visibleInvoices.map(i=><button className={`row ${selected===i.id?'chosen':''}`} key={i.id} onClick={()=>setSelected(i.id)}><span className="file-icon"><FileText size={17}/></span><span className="row-copy"><b>{i.supplier_name || 'New invoice — details needed'}</b><small>{i.invoice_number || i.source_name || 'Uploaded document'}</small><small className="row-status">{i.status.replace('_',' ')}</small></span><b className="amount">{fmt(i.total, i.currency)}</b><ChevronRight size={15}/></button>)}{!invoices.length ? <div className="empty"><Upload size={22}/><b>No invoices yet</b><span>Upload a PDF or photo to start the local review flow.</span></div> : visibleInvoices.length === 0 ? <div className="empty"><FileText size={22}/><b>No matching invoices</b><span>Try another summary card or change your search.</span></div> : null}</div></div>
    {current ? <div className="review"><div className="review-head"><div><small>REVIEW INVOICE #{current.id}</small><h2>{current.source_name || 'Invoice details'}</h2></div><span className={`badge ${current.status}`}>{current.status.replace('_',' ')}</span></div><div className="source"><div className="source-head"><b>Source document</b><div className="source-actions"><button type="button" className="ocr-action" onClick={runOcr} disabled={ocrBusy || current.status !== 'needs_review'}>{ocrBusy ? 'Reading…' : current.ocr_text ? 'Run OCR again' : 'Read with OCR'}</button><a href={`${API}/api/files/${current.id}`} target="_blank" rel="noreferrer">Open original ↗</a></div></div>{current.source_name.match(/\.(png|jpe?g|webp)$/i)?<img crossOrigin="use-credentials" src={`${API}/api/files/${current.id}`} alt="Uploaded invoice"/>:<PdfPreview key={current.id} fileUrl={`${API}/api/files/${current.id}`}/>}</div>{current.ocr_text && <section className={`ocr-result ${current.ocr_status==='low_confidence'?'ocr-low':''}`}><div><b>OCR text</b><span>{current.ocr_provider} · {Math.round(Number(current.ocr_confidence || 0)*100)}% confidence{current.ocr_status==='low_confidence'?' · verify manually':''}</span></div><p>OCR reads text only. Confirm every value against the source before saving or approving.</p><pre>{current.ocr_text}</pre></section>}
      <div className="form-head"><div><h3>Invoice details</h3><span>Enter values by checking the original document.</span></div><span className="manual">Manual entry</span></div><div className="fields"><label>SUPPLIER NAME<input value={current.supplier_name} onChange={e=>patchLocal('supplier_name',e.target.value)}/></label><label>SUPPLIER GSTIN<input value={current.supplier_gstin} onChange={e=>patchLocal('supplier_gstin',e.target.value)}/></label><label>INVOICE NUMBER<input value={current.invoice_number} onChange={e=>patchLocal('invoice_number',e.target.value)}/></label><label>INVOICE DATE<input type="date" value={current.invoice_date||''} onChange={e=>patchLocal('invoice_date',e.target.value||null)}/></label><label>CURRENCY<select value={current.currency} onChange={e=>patchLocal('currency',e.target.value)}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>SUBTOTAL<input type="number" step="0.01" value={current.subtotal} onChange={e=>patchLocal('subtotal',Number(e.target.value))}/></label><label>TAX TOTAL<input type="number" step="0.01" value={current.tax_amount} onChange={e=>patchLocal('tax_amount',Number(e.target.value))}/></label><label className="wide">INVOICE TOTAL<input type="number" step="0.01" value={current.total} onChange={e=>patchLocal('total',Number(e.target.value))}/></label></div>
      <div className={`total-reconciliation ${invoiceTotalMatches ? 'matched' : 'mismatch'}`} role="status"><div className="total-reconciliation-icon">{invoiceTotalMatches ? <Check size={16}/> : <AlertCircle size={16}/>}</div><div className="total-reconciliation-copy"><small>CALCULATED TOTAL <span>{fmt(lineSubtotal, current.currency)} subtotal + {fmt(current.tax_amount, current.currency)} tax</span></small><b>{fmt(calculatedTotal, current.currency)}</b><p>{invoiceTotalMatches ? 'Matches the entered invoice amounts.' : current.lines.length && Math.abs(lineSubtotal - Number(current.subtotal || 0)) > 0.01 ? `Line items differ from the entered subtotal by ${fmt(lineSubtotal - Number(current.subtotal || 0), current.currency)}.` : `Does not match the entered total of ${fmt(current.total, current.currency)}. Difference: ${fmt(calculatedTotal - Number(current.total || 0), current.currency)}.`}</p></div>{!invoiceTotalMatches && <button type="button" onClick={() => patchLocal('total', calculatedTotal)}>Use calculated total</button>}</div>
      <div className="line-head"><h3>Line items</h3><button onClick={addLine}><Plus size={14}/> Add line</button></div>{current.lines.map((line,index)=><div className="line-edit" key={index}><input placeholder="Description" value={line.description} onChange={e=>{const a=[...current.lines];a[index]={...line,description:e.target.value};patchLocal('lines',a)}}/><input aria-label="Quantity" type="number" step="0.01" value={line.quantity} onChange={e=>{const a=[...current.lines];const q=Number(e.target.value);a[index]={...line,quantity:q,amount:q*line.rate};patchLocal('lines',a)}}/><input aria-label="Rate" type="number" step="0.01" value={line.rate} onChange={e=>{const a=[...current.lines];const r=Number(e.target.value);a[index]={...line,rate:r,amount:line.quantity*r};patchLocal('lines',a)}}/><b>{fmt(line.amount, current.currency)}</b><button onClick={()=>patchLocal('lines',current.lines.filter((_,n)=>n!==index))}>×</button></div>)}<div className="review-footer"><span><Check size={15}/> Only reviewed invoices can be approved.</span><div><button className="save" onClick={save}>Save draft</button><button className="approve" onClick={approve}><Check size={15}/> Review & approve</button></div></div>
    </div> : <div className="review empty-review"><FileText size={30}/><b>Select an invoice to review</b><span>Upload a document or choose one from the list.</span></div>}
    <aside className="detail-rail">{current ? <><div className="supplier-card"><div className="supplier-avatar">{(current.supplier_name || 'S').slice(0,1).toUpperCase()}</div><small>SUPPLIER</small><h2>{current.supplier_name || 'Supplier details'}</h2><p>{current.supplier_gstin || 'GSTIN not entered'}</p><span className={`badge ${current.status}`}>{current.status.replace('_',' ')}</span></div><div className="rail-card"><h3>Invoice summary</h3><div className="rail-row"><span>Invoice number</span><b>{current.invoice_number || '—'}</b></div><div className="rail-row"><span>Invoice date</span><b>{current.invoice_date || '—'}</b></div><div className="rail-row"><span>Subtotal</span><b>{fmt(current.subtotal, current.currency)}</b></div><div className="rail-row"><span>Tax total</span><b>{fmt(current.tax_amount, current.currency)}</b></div><div className="rail-total"><span>Total due</span><b>{fmt(current.total, current.currency)}</b></div></div><div className="rail-card source-meta"><h3>Source file</h3><FileCheck2 size={17}/><span>{current.source_name || 'No file name'}</span></div><div className="rail-card audit-card"><h3><Clock3 size={15}/> Activity history</h3>{invoiceEvents.length ? invoiceEvents.map(event => <div className="audit-event" key={event.id}><b>{event.event_type.replaceAll('_',' ')}</b><small>{event.details}</small><small>{event.actor} · {new Date(event.created_at).toLocaleString()}</small></div>) : <p>No activity recorded yet.</p>}</div></> : <div className="rail-card rail-empty"><FileCheck2 size={22}/><h3>Invoice details</h3><p>Select an invoice to see supplier information and totals.</p></div>}</aside></section>
    </>}
    </div></main></div>
}
