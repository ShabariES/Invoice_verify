import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { AlertCircle, Bell, Check, ChevronDown, ChevronRight, Clock3, FileCheck2, FileText, LayoutDashboard, LogOut, MailCheck, MessageCircle, Plus, Search, Upload, UsersRound, X } from 'lucide-react'
import PdfPreview from './PdfPreview'
import AuthScreen, { AuthUser } from './AuthScreen'
import { CrmHome, Lead, LeadsPage } from './CrmPages'
import LandingPage from './LandingPage'
import { API, apiFetch } from './api'

type Line = { description: string; quantity: number; rate: number; amount: number }
type OcrField = { value: string; confidence: number }
type TaxCalculation = 'amount' | 'percentage' | 'simple_interest' | 'compound_interest'
type Invoice = { id: number; invoice_number: string; invoice_date: string | null; supplier_name: string; supplier_gstin: string; currency: string; subtotal: number; tax_amount: number; tax_calculation: TaxCalculation; tax_rate: number; interest_period_months: number; compounding_frequency: number; total: number; source_path: string; source_name: string; status: string; reviewer: string; lines: Line[]; ocr_status: string; ocr_provider: string; ocr_confidence: number | null; ocr_text: string; ocr_fields: Record<string, OcrField> }
type InvoiceEvent = { id: number; invoice_id: number; event_type: string; actor: string; details: string; created_at: string }
type AppNotification = { id: number; title: string; message: string; category: string; entity_type: string; entity_id: number | null; read_at: string | null; created_at: string }
const empty = (id: number): Invoice => ({ id, invoice_number: '', invoice_date: null, supplier_name: '', supplier_gstin: '', currency: 'INR', subtotal: 0, tax_amount: 0, tax_calculation: 'amount', tax_rate: 0, interest_period_months: 12, compounding_frequency: 1, total: 0, source_path: '', source_name: '', status: 'needs_review', reviewer: '', lines: [], ocr_status: 'not_run', ocr_provider: '', ocr_confidence: null, ocr_text: '', ocr_fields: {} })
const fmt = (v: number, currency = 'INR') => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(Number(v || 0))
const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100
function calculateTax(base: number, rate: number, mode: TaxCalculation, periodMonths: number, frequency: number) {
  const annualRate = Math.max(0, Number(rate) || 0) / 100
  const years = Math.max(0, Number(periodMonths) || 0) / 12
  if (mode === 'percentage') return roundMoney(base * annualRate)
  if (mode === 'simple_interest') return roundMoney(base * annualRate * years)
  if (mode === 'compound_interest') {
    const periods = Math.max(1, Number(frequency) || 1) * years
    return roundMoney(base * (Math.pow(1 + annualRate / Math.max(1, Number(frequency) || 1), periods) - 1))
  }
  return roundMoney(Number(base) || 0)
}
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
function normalizeOcrTax(invoice: Invoice): Invoice {
  // Older saved OCR results stored "10%" as a fixed amount of 10. Recover the
  // explicit rate from the recognized text when opening or reapplying a record.
  const match = invoice.ocr_text?.match(/\b(?:tax|gst|vat|interest)\b[^\r\n%]{0,40}?(\d{1,3}(?:\.\d+)?)\s*%/i)
  if (!match) return invoice
  const rate = Number(match[1])
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return invoice
  const subtotal = invoice.lines?.length
    ? invoice.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
    : Number(invoice.subtotal || 0)
  const taxAmount = roundMoney(subtotal * rate / 100)
  const confidence = Number(invoice.ocr_confidence || 0.9)
  return {
    ...invoice,
    tax_calculation: 'percentage',
    tax_rate: rate,
    tax_amount: taxAmount,
    ocr_fields: {
      ...(invoice.ocr_fields || {}),
      tax_calculation: { value: 'percentage', confidence },
      tax_rate: { value: String(rate), confidence },
      tax_amount: { value: String(taxAmount), confidence },
    },
  }
}

export default function App() {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authIntent, setAuthIntent] = useState<'signup' | 'signin'>('signup')
  const [activeView, setActiveView] = useState<'home' | 'leads' | 'invoices' | 'notifications'>('home')
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
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationChannels, setNotificationChannels] = useState<{ email: boolean; whatsapp: boolean; whatsapp_manual?: boolean; email_inbound?: boolean; email_inbound_address?: string; whatsapp_inbound?: boolean; whatsapp_inbound_number?: string }>({ email: false, whatsapp: false })
  const [notificationPrefs, setNotificationPrefs] = useState({ phone: '', whatsapp_opt_in: false })
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsMessage, setPrefsMessage] = useState('')
  const dashboardScrollRef = useRef<HTMLDivElement>(null)
  const current = invoices.find(i => i.id === selected) || null
  const invoiceMistakes = invoices.reduce((sum, invoice) => sum + countInvoiceMistakes(invoice), 0)
  const searchMatchesInvoice = (invoice: Invoice) => `${invoice.supplier_name} ${invoice.invoice_number} ${invoice.source_name}`.toLowerCase().includes(query.toLowerCase())
  const invoiceStatusGroups = [
    { key: 'needs_review' as const, title: 'Needs review', hint: 'Waiting for a human check', items: invoices.filter(invoice => invoice.status === 'needs_review' && searchMatchesInvoice(invoice)) },
    { key: 'approved' as const, title: 'Approved', hint: 'Reviewed and completed', items: invoices.filter(invoice => invoice.status === 'approved' && searchMatchesInvoice(invoice)) },
    { key: 'mistakes' as const, title: 'With mistakes', hint: 'Amount or line mismatches', items: invoices.filter(invoice => countInvoiceMistakes(invoice) > 0 && searchMatchesInvoice(invoice)) },
  ]
  const invoiceList = invoiceFilter === 'all' ? invoices.filter(searchMatchesInvoice) : invoiceStatusGroups.find(group => group.key === invoiceFilter)?.items ?? []
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
      const data: Invoice[] = (await res.json()).map(normalizeOcrTax); setInvoices(data)
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
  useEffect(() => { if (user) void refresh(); else { setInvoices([]); setSelected(null) } }, [user])
  useEffect(() => {
    if (!user) return
    let active = true
    const syncIncomingInvoices = async () => {
      try {
        const response = await apiFetch(`${API}/api/invoices`)
        if (!response.ok) return
        const incoming: Invoice[] = (await response.json()).map(normalizeOcrTax)
        if (!active) return
        setInvoices(currentInvoices => {
          const knownIds = new Set(currentInvoices.map(invoice => invoice.id))
          const newlyReceived = incoming.filter(invoice => !knownIds.has(invoice.id))
          return newlyReceived.length ? [...newlyReceived, ...currentInvoices] : currentInvoices
        })
      } catch { /* Intake sync is best effort; retry on the next interval or tab focus. */ }
    }
    const onFocus = () => { if (document.visibilityState === 'visible') void syncIncomingInvoices() }
    const timer = window.setInterval(() => void syncIncomingInvoices(), 10_000)
    window.addEventListener('focus', onFocus)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [user])
  useEffect(() => {
    if (!user) { setNotifications([]); return }
    const load = async () => {
      try {
        const response = await apiFetch(`${API}/api/notifications`)
        if (response.ok) setNotifications(await response.json())
        const preferences = await apiFetch(`${API}/api/auth/notification-preferences`)
        if (preferences.ok) setNotificationPrefs(await preferences.json())
        const channels = await apiFetch(`${API}/api/notifications/status`)
        if (channels.ok) setNotificationChannels(await channels.json())
      } catch { /* Notification polling is best effort; the workspace remains usable. */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [user])
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
    setOcrBusy(true); setMessage('Reading the document and identifying invoice fields…')
    try {
      const response = await apiFetch(`${API}/api/invoices/${current.id}/extract`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'OCR failed')
      const fields = data.invoice.ocr_fields || {}
      const next: Partial<Invoice> = {}
      const assignText = (field: string, key: 'supplier_name' | 'supplier_gstin' | 'invoice_number' | 'invoice_date' | 'currency') => {
        const value = fields[field]?.value
        if (value) next[key] = value as never
      }
      assignText('supplier_name', 'supplier_name')
      assignText('supplier_gstin', 'supplier_gstin')
      assignText('invoice_number', 'invoice_number')
      assignText('invoice_date', 'invoice_date')
      assignText('currency', 'currency')
      const calculation = fields.tax_calculation?.value
      if (calculation === 'amount' || calculation === 'percentage' || calculation === 'simple_interest' || calculation === 'compound_interest') next.tax_calculation = calculation
      if (fields.tax_rate?.value && Number.isFinite(Number(fields.tax_rate.value))) next.tax_rate = Number(fields.tax_rate.value)
      for (const field of ['subtotal', 'tax_amount', 'total'] as const) {
        const value = fields[field]?.value
        if (value && Number.isFinite(Number(value))) next[field] = Number(value)
      }
      setInvoices(rows => rows.map(invoice => invoice.id === data.invoice.id ? normalizeOcrTax({ ...data.invoice, ...next }) : invoice))
      const fieldCount = Object.keys(fields).length
      setMessage(fieldCount
        ? `OCR copied ${fieldCount} detected value${fieldCount === 1 ? '' : 's'} into Invoice details. Check them against the source before saving.`
        : 'OCR read the document text but could not safely identify fields. Review the recognized text and enter the values in Invoice details.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'OCR failed') }
    finally { setOcrBusy(false) }
  }
  function patchLocal(key: keyof Invoice, value: unknown) {
    if (!current) return
    setInvoices(rows => rows.map(i => {
      if (i.id !== current.id) return i
      const updated = { ...i, [key]: value } as Invoice
      if (updated.tax_calculation !== 'amount' && ['subtotal', 'lines', 'tax_calculation', 'tax_rate', 'interest_period_months', 'compounding_frequency'].includes(key)) {
        const base = updated.lines.length ? updated.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0) : Number(updated.subtotal || 0)
        updated.tax_amount = calculateTax(base, updated.tax_rate, updated.tax_calculation, updated.interest_period_months, updated.compounding_frequency)
      }
      return updated
    }))
  }
  function applyOcrSuggestions() {
    if (!current) return
    const fields = current.ocr_fields || {}
    const next: Partial<Invoice> = {}
    const assignText = (field: string, key: 'supplier_name' | 'supplier_gstin' | 'invoice_number' | 'invoice_date' | 'currency') => {
      const value = fields[field]?.value
      if (value) next[key] = value as never
    }
    assignText('supplier_name', 'supplier_name')
    assignText('supplier_gstin', 'supplier_gstin')
    assignText('invoice_number', 'invoice_number')
    assignText('invoice_date', 'invoice_date')
    assignText('currency', 'currency')
    const calculation = fields.tax_calculation?.value
    if (calculation === 'amount' || calculation === 'percentage' || calculation === 'simple_interest' || calculation === 'compound_interest') next.tax_calculation = calculation
    if (fields.tax_rate?.value && Number.isFinite(Number(fields.tax_rate.value))) next.tax_rate = Number(fields.tax_rate.value)
    for (const field of ['subtotal', 'tax_amount', 'total'] as const) {
      const value = fields[field]?.value
      if (value && Number.isFinite(Number(value))) next[field] = Number(value)
    }
    setInvoices(rows => rows.map(invoice => invoice.id === current.id ? normalizeOcrTax({ ...invoice, ...next }) : invoice))
    setMessage('Suggestions copied into the invoice form. Verify each value against the original, then save the draft.')
  }
  async function save() {
    if (!current) return
    const payload = { invoice_number: current.invoice_number, invoice_date: current.invoice_date || null, supplier_name: current.supplier_name, supplier_gstin: current.supplier_gstin, currency: current.currency, subtotal: Number(current.subtotal), tax_amount: Number(current.tax_amount), tax_calculation: current.tax_calculation, tax_rate: Number(current.tax_rate), interest_period_months: Number(current.interest_period_months), compounding_frequency: Number(current.compounding_frequency), total: Number(current.total), lines: current.lines }
    const res = await apiFetch(`${API}/api/invoices/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json(); if (!res.ok) { setMessage(typeof data.detail === 'string' ? data.detail : 'Could not save invoice'); return }
    setInvoices(rows => rows.map(i => i.id === data.id ? data : i)); setMessage('Invoice details saved.')
  }
  async function approve() {
    if (!current) return
    const saved = await apiFetch(`${API}/api/invoices/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_number: current.invoice_number, invoice_date: current.invoice_date || null, supplier_name: current.supplier_name, supplier_gstin: current.supplier_gstin, currency: current.currency, subtotal: Number(current.subtotal), tax_amount: Number(current.tax_amount), tax_calculation: current.tax_calculation, tax_rate: Number(current.tax_rate), interest_period_months: Number(current.interest_period_months), compounding_frequency: Number(current.compounding_frequency), total: Number(current.total), lines: current.lines }) })
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
  async function openNotification(item: AppNotification) {
    if (!item.read_at) {
      const response = await apiFetch(`${API}/api/notifications/${item.id}/read`, { method: 'POST' }).catch(() => null)
      if (response?.ok) setNotifications(items => items.map(currentItem => currentItem.id === item.id ? { ...currentItem, read_at: new Date().toISOString() } : currentItem))
    }
    setNotificationOpen(false)
    if (item.entity_type === 'invoice' && item.entity_id) { setSelected(item.entity_id); setActiveView('invoices') }
    else if (item.entity_type === 'lead') openLeads()
  }
  async function markAllNotificationsRead() {
    const response = await apiFetch(`${API}/api/notifications/read-all`, { method: 'POST' }).catch(() => null)
    if (response?.ok) setNotifications(items => items.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() })))
  }
  async function refreshNotifications() {
    const response = await apiFetch(`${API}/api/notifications`).catch(() => null)
    if (response?.ok) setNotifications(await response.json())
  }
  async function saveNotificationPrefs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPrefsSaving(true); setPrefsMessage('')
    try {
      const response = await apiFetch(`${API}/api/auth/notification-preferences`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notificationPrefs) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not save notification preferences.')
      setNotificationPrefs(data); setPrefsMessage('WhatsApp preferences saved.')
    } catch (error) { setPrefsMessage(error instanceof Error ? error.message : 'Could not save notification preferences.') }
    finally { setPrefsSaving(false) }
  }
  const openLeads = (filter = 'all') => { setLeadFilterIntent(filter); setActiveView('leads') }
  const createLead = () => { openLeads('all'); setCreateLeadRequest(count => count + 1) }
  const searchValue = activeView === 'invoices' ? query : leadQuery
  const setSearchValue = activeView === 'invoices' ? setQuery : setLeadQuery
  const pageTitle = activeView === 'home' ? 'Overview' : activeView === 'leads' ? 'Leads' : activeView === 'notifications' ? 'Notifications' : 'Invoices'
  const unreadNotifications = notifications.filter(item => !item.read_at)
  return <div className="layout"><aside className="side"><div className="logo"><span>T</span><div><b>TECHJAYS</b><small>ACCOUNTING CRM</small></div></div><div className="nav-caption">WORKSPACE</div><button type="button" className={`nav ${activeView==='home'?'active':''}`} onClick={()=>setActiveView('home')}><LayoutDashboard size={18}/> Overview</button><button type="button" className={`nav ${activeView==='leads'?'active':''}`} onClick={()=>openLeads('all')}><UsersRound size={18}/> Leads <b>{leads.filter(lead=>!['won','lost'].includes(lead.status)).length}</b></button><div className="nav-caption nav-caption-secondary">ACCOUNTING</div><button type="button" className={`nav ${activeView==='invoices'?'active':''}`} onClick={()=>setActiveView('invoices')}><FileText size={18}/> Invoices <b>{invoices.filter(i=>i.status==='needs_review').length}</b></button><button type="button" className={`nav ${activeView==='notifications'?'active':''}`} onClick={()=>setActiveView('notifications')}><Bell size={18}/> Notifications {notifications.some(item=>!item.read_at) && <b>{notifications.filter(item=>!item.read_at).length}</b>}</button><div className="local-tag"><i/> {user?.role === 'admin' ? 'ADMIN ACCESS' : 'APPROVED LEAD ACCESS'}</div><div className="side-foot">Signed in as<br/>{user?.email}</div></aside>
    <main><header><div className="crumb"><span>Workspace</span><ChevronRight size={14}/><b>{pageTitle}</b></div><label className="top-search"><Search size={17}/><input placeholder={activeView==='invoices'?'Search invoices, suppliers…':'Search leads, companies…'} value={searchValue} onChange={e=>{setSearchValue(e.target.value);if(activeView==='home'&&e.target.value)openLeads('all')}}/></label><div className="top-actions"><div className="notification-wrap"><button type="button" className={`notification-trigger ${notificationOpen ? 'active' : ''}`} aria-label={`Notifications${notifications.filter(item => !item.read_at).length ? `, ${notifications.filter(item => !item.read_at).length} unread` : ''}`} aria-expanded={notificationOpen} onClick={() => setNotificationOpen(open => !open)}><Bell size={18}/>{notifications.some(item => !item.read_at) && <i>{notifications.filter(item => !item.read_at).length > 9 ? '9+' : notifications.filter(item => !item.read_at).length}</i>}</button>{notificationOpen && <section className="notification-popover"><div className="notification-popover-head"><div><b>Notifications</b><small>{notifications.filter(item => !item.read_at).length} unread</small></div><button type="button" onClick={() => void markAllNotificationsRead()} disabled={!notifications.some(item => !item.read_at)}>Mark all read</button></div><div className="notification-list">{unreadNotifications.length ? unreadNotifications.slice(0, 20).map(item => <button type="button" className="notification-item unread" key={item.id} onClick={() => void openNotification(item)}><span className={`notification-symbol ${item.category}`}><Bell size={14}/></span><span><b>{item.title}</b><small>{item.message}</small><time>{new Date(item.created_at).toLocaleString()}</time></span></button>) : <p className="notification-empty">You’re all caught up.</p>}</div><form className="notification-prefs" onSubmit={saveNotificationPrefs}><b>WhatsApp preferences</b><label>Phone number<input type="tel" value={notificationPrefs.phone} maxLength={32} placeholder="+91 98765 43210" onChange={event => setNotificationPrefs(state => ({ ...state, phone: event.target.value }))}/></label><label className="notification-prefs-opt"><input type="checkbox" checked={notificationPrefs.whatsapp_opt_in} onChange={event => setNotificationPrefs(state => ({ ...state, whatsapp_opt_in: event.target.checked }))}/> I agree to receive account and workflow updates on WhatsApp.</label><div><button type="submit" disabled={prefsSaving}>{prefsSaving ? 'Saving…' : 'Save preference'}</button>{prefsMessage && <small role="status">{prefsMessage}</small>}</div></form><div className="notification-channel-status"><span><MailCheck size={14}/> Email alerts <b className={notificationChannels.email ? 'configured' : ''}>{notificationChannels.email ? 'Ready' : 'Not set up'}</b></span><span><MessageCircle size={14}/> WhatsApp alerts <b className={notificationChannels.whatsapp ? 'configured' : ''}>{notificationChannels.whatsapp ? 'Ready' : 'Not set up'}</b></span><span><MessageCircle size={14}/> Manual WhatsApp chat <b className={notificationChannels.whatsapp_manual ? 'configured' : ''}>{notificationChannels.whatsapp_manual ? 'Ready' : 'Not set up'}</b></span><span><MailCheck size={14}/> Receive invoices by email <b className={notificationChannels.email_inbound ? 'configured' : ''}>{notificationChannels.email_inbound ? notificationChannels.email_inbound_address || 'Ready' : 'Not set up'}</b></span><span><MessageCircle size={14}/> Receive invoices by WhatsApp <b className={notificationChannels.whatsapp_inbound ? 'configured' : ''}>{notificationChannels.whatsapp_inbound ? notificationChannels.whatsapp_inbound_number || 'Ready' : 'Not set up'}</b></span><small>Send a PDF or invoice image from the approved account email or WhatsApp number. Attachments go only to that account.</small></div></section>}</div><span className="profile-chip"><b>{(user?.name || 'U').slice(0,2).toUpperCase()}</b><span>{user?.role === 'admin' ? 'Admin' : 'Lead'}</span></span><button type="button" className="signout-button" onClick={signOut}><LogOut size={15}/> Sign out</button></div></header><div className="dashboard-scroll" ref={dashboardScrollRef}>
    {activeView === 'home' && <CrmHome leads={leads} invoiceCount={invoices.length} canViewAccounting={!!user} onOpenLeads={openLeads} onOpenInvoices={()=>setActiveView('invoices')} onCreateLead={createLead}/>}
    {activeView === 'leads' && <LeadsPage isAdmin={user?.role === 'admin'} leads={leads} onLeadsChange={setLeads} createRequest={createLeadRequest} query={leadQuery} initialFilter={leadFilterIntent}/>}
    {activeView === 'invoices' && <>
    <section className="heading"><div><div className="kicker">SUPPLIER OPERATIONS</div><h1>Invoice desk</h1><p>{user?.role === 'admin' ? 'Review invoices across all Lead workspaces.' : 'Your private invoice workspace. Only your account and Admins can access these documents.'}</p></div><label className="upload"><Upload size={16}/> {busy ? 'Uploading…' : 'Upload invoice'}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={upload} disabled={busy}/></label></section>
    <section className="summary" aria-label="Invoice summaries">
      <button type="button" className={invoiceFilter === 'all' ? 'selected' : ''} aria-pressed={invoiceFilter === 'all'} onClick={() => applyInvoiceFilter('all')}><span>Total invoices</span><b>{invoices.length}</b><small className="summary-note">Show every invoice</small></button>
      <button type="button" className={invoiceFilter === 'needs_review' ? 'selected' : ''} aria-pressed={invoiceFilter === 'needs_review'} onClick={() => applyInvoiceFilter('needs_review')}><span>Needs review</span><b>{invoices.filter(i=>i.status==='needs_review').length}</b><small className="summary-note">Open the review queue</small></button>
      <button type="button" className={invoiceFilter === 'approved' ? 'selected' : ''} aria-pressed={invoiceFilter === 'approved'} onClick={() => applyInvoiceFilter('approved')}><span>Approved</span><b>{invoices.filter(i=>i.status==='approved').length}</b><small className="summary-note">Show approved invoices</small></button>
      <button type="button" className="workflow-summary" onClick={() => applyInvoiceFilter('needs_review', 'Every invoice needs a named human reviewer before it can be approved. The review queue is open below.')}><span>Human approval</span><b className="safe">Required</b><small className="summary-note">Before an invoice is approved</small></button>
      <button type="button" className={invoiceFilter === 'mistakes' ? 'selected' : ''} aria-pressed={invoiceFilter === 'mistakes'} onClick={() => applyInvoiceFilter('mistakes')} title="Show invoices with amount or line calculation issues"><span>Total mistakes</span><b className={invoiceMistakes ? 'attention' : ''}>{invoiceMistakes}</b><small className="summary-note">Amount and line mismatches</small></button>
    </section>
    {message && <div className="message"><span>{message}</span><button onClick={()=>setMessage('')}><X size={15}/></button></div>}
    <section className="content"><section className="invoice-list-panel"><div className="invoice-list-panel-head"><div><button type="button" className="invoice-list-title" onClick={()=>applyInvoiceFilter('all')}>{invoiceFilter==='all'?'All invoices':invoiceFilter==='needs_review'?'Needs review':invoiceFilter==='approved'?'Approved invoices':invoiceFilter==='mistakes'?'Invoices with mistakes':'All invoices'}</button><small>Showing {invoiceList.length} of {invoices.length} invoices</small></div><label className="small-upload"><Plus size={15}/> Add invoice<input type="file" accept="application/pdf,image/*" onChange={upload}/></label></div><div className="invoice-list-stack">{invoiceList.length?invoiceList.map(i=><button type="button" className={`invoice-wide-row ${selected===i.id?'chosen':''}`} key={i.id} onClick={()=>{setSelected(i.id);window.setTimeout(()=>document.querySelector('.layout .review')?.scrollIntoView({behavior:'smooth',block:'start'}),60)}}><span className="file-icon"><FileText size={18}/></span><span className="invoice-wide-main"><b>{i.supplier_name||'Supplier details needed'}</b><small>{i.source_name||'Invoice document'}{i.invoice_number?` · ${i.invoice_number}`:''}</small></span><span className="invoice-wide-status"><small className={invoiceFilter==='mistakes'?'has-mistakes':i.status}>{invoiceFilter==='mistakes'?`${countInvoiceMistakes(i)} issue${countInvoiceMistakes(i)===1?'':'s'}`:i.status.replace('_',' ')}</small></span><span className="invoice-wide-date">{i.invoice_date||'Date not entered'}</span><b className="invoice-wide-amount">{fmt(i.total,i.currency)}</b><ChevronRight size={17}/></button>):<div className="invoice-status-empty">{query?'No matching invoices':invoiceFilter==='mistakes'?'No invoices have amount or line mismatches.':'No invoices in this section yet.'}</div>}</div></section>    {current ? <div className="review"><div className="review-head"><div><small>REVIEW INVOICE #{current.id}</small><h2>{current.source_name || 'Invoice details'}</h2></div><span className={`badge ${current.status}`}>{current.status.replace('_',' ')}</span></div><div className="source"><div className="source-head"><b>Source document</b><div className="source-actions"><button type="button" className="ocr-action" onClick={runOcr} disabled={ocrBusy || current.status !== 'needs_review'}>{ocrBusy ? 'Reading…' : current.ocr_text ? 'Run OCR again' : 'Read with OCR'}</button><a href={`${API}/api/files/${current.id}`} target="_blank" rel="noreferrer">Open original ↗</a></div></div>{current.source_name.match(/\.(png|jpe?g|webp)$/i)?<img crossOrigin="use-credentials" src={`${API}/api/files/${current.id}`} alt="Uploaded invoice"/>:<PdfPreview key={current.id} fileUrl={`${API}/api/files/${current.id}`}/>}</div>
      <div className="form-head"><div><h3>Invoice details</h3><span>{current.ocr_text ? 'OCR values are copied below; verify them against the source before saving.' : 'Enter values by checking the original document.'}</span></div><span className="manual">{current.ocr_text ? `${Object.keys(current.ocr_fields || {}).length} OCR fields` : 'Manual entry'}</span></div>{current.ocr_text && <section className={`ocr-result ocr-inline ${current.ocr_status==='low_confidence'?'ocr-low':''}`}><div className="ocr-result-head"><div><b>OCR readout</b><span>{current.ocr_provider} · {Math.round(Number(current.ocr_confidence || 0)*100)}% confidence · check fields below</span></div>{Object.keys(current.ocr_fields || {}).length > 0 && <button type="button" onClick={applyOcrSuggestions}>Reapply OCR values</button>}</div><details className="ocr-raw"><summary>View recognized text</summary><pre>{current.ocr_text}</pre></details></section>}<div className="fields"><label>SUPPLIER NAME<input value={current.supplier_name} onChange={e=>patchLocal('supplier_name',e.target.value)}/></label><label>SUPPLIER GSTIN<input value={current.supplier_gstin} onChange={e=>patchLocal('supplier_gstin',e.target.value)}/></label><label>INVOICE NUMBER<input value={current.invoice_number} onChange={e=>patchLocal('invoice_number',e.target.value)}/></label><label>INVOICE DATE<input type="date" value={current.invoice_date||''} onChange={e=>patchLocal('invoice_date',e.target.value||null)}/></label><label>CURRENCY<select value={current.currency} onChange={e=>patchLocal('currency',e.target.value)}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>SUBTOTAL<input type="number" step="0.01" value={current.subtotal} onChange={e=>patchLocal('subtotal',Number(e.target.value))}/></label><label>CALCULATION METHOD<select value={current.tax_calculation || 'amount'} onChange={e=>patchLocal('tax_calculation',e.target.value as TaxCalculation)}><option value="amount">Fixed amount</option><option value="percentage">Direct percentage</option><option value="simple_interest">Simple interest (SI)</option><option value="compound_interest">Compound interest (CI)</option></select></label>{current.tax_calculation !== 'amount' && <label>{current.tax_calculation === 'percentage' ? 'RATE (%)' : 'ANNUAL RATE (%)'}<input type="number" min="0" max="100" step="0.01" value={current.tax_rate ?? 0} onChange={e=>patchLocal('tax_rate',Number(e.target.value))}/></label>}{(current.tax_calculation === 'simple_interest' || current.tax_calculation === 'compound_interest') && <label>PERIOD (MONTHS)<input type="number" min="1" max="120" step="1" value={current.interest_period_months || 12} onChange={e=>patchLocal('interest_period_months',Math.min(120,Math.max(1,Number(e.target.value))))}/></label>}{current.tax_calculation === 'compound_interest' && <label>COMPOUNDING<select value={current.compounding_frequency || 1} onChange={e=>patchLocal('compounding_frequency',Number(e.target.value))}><option value="1">Annually</option><option value="2">Semi-annually</option><option value="4">Quarterly</option><option value="12">Monthly</option></select></label>}<label>TAX / INTEREST AMOUNT<input type="number" step="0.01" value={current.tax_amount} readOnly={current.tax_calculation !== 'amount'} onChange={e=>patchLocal('tax_amount',Number(e.target.value))}/></label>{current.tax_calculation !== 'amount' && <p className="tax-calc-note wide">{current.tax_calculation === 'percentage' ? 'Calculated as subtotal × rate.' : current.tax_calculation === 'simple_interest' ? 'SI = principal × annual rate × time in years.' : 'CI = principal × [(1 + annual rate ÷ compounds per year)^(compounds per year × years) − 1].'} The result is added to the subtotal; compare it with the invoice total.</p>}<label className="wide">INVOICE TOTAL<input type="number" step="0.01" value={current.total} onChange={e=>patchLocal('total',Number(e.target.value))}/></label></div>
      <div className={`total-reconciliation ${invoiceTotalMatches ? 'matched' : 'mismatch'}`} role="status"><div className="total-reconciliation-icon">{invoiceTotalMatches ? <Check size={16}/> : <AlertCircle size={16}/>}</div><div className="total-reconciliation-copy"><small>CALCULATED TOTAL <span>{fmt(lineSubtotal, current.currency)} subtotal + {fmt(current.tax_amount, current.currency)} tax / interest</span></small><b>{fmt(calculatedTotal, current.currency)}</b><p>{invoiceTotalMatches ? 'Matches the entered invoice amounts.' : current.lines.length && Math.abs(lineSubtotal - Number(current.subtotal || 0)) > 0.01 ? `Line items differ from the entered subtotal by ${fmt(lineSubtotal - Number(current.subtotal || 0), current.currency)}.` : `Does not match the entered total of ${fmt(current.total, current.currency)}. Difference: ${fmt(calculatedTotal - Number(current.total || 0), current.currency)}.`}</p></div>{!invoiceTotalMatches && <button type="button" onClick={() => patchLocal('total', calculatedTotal)}>Use calculated total</button>}</div>
      <div className="line-head"><h3>Line items</h3><button onClick={addLine}><Plus size={14}/> Add line</button></div>{current.lines.map((line,index)=><div className="line-edit" key={index}><input placeholder="Description" value={line.description} onChange={e=>{const a=[...current.lines];a[index]={...line,description:e.target.value};patchLocal('lines',a)}}/><input aria-label="Quantity" type="number" step="0.01" value={line.quantity} onChange={e=>{const a=[...current.lines];const q=Number(e.target.value);a[index]={...line,quantity:q,amount:q*line.rate};patchLocal('lines',a)}}/><input aria-label="Rate" type="number" step="0.01" value={line.rate} onChange={e=>{const a=[...current.lines];const r=Number(e.target.value);a[index]={...line,rate:r,amount:line.quantity*r};patchLocal('lines',a)}}/><b>{fmt(line.amount, current.currency)}</b><button onClick={()=>patchLocal('lines',current.lines.filter((_,n)=>n!==index))}>×</button></div>)}<div className="review-footer"><span><Check size={15}/> {user?.role === 'admin' ? 'Only reviewed invoices can be approved.' : 'Saved invoices wait for Admin approval.'}</span><div><button className="save" onClick={save}>Save draft</button>{user?.role === 'admin' && <button className="approve" onClick={approve}><Check size={15}/> Review & approve</button>}</div></div>
    </div> : <div className="review empty-review"><FileText size={30}/><b>Select an invoice to review</b><span>Upload a document or choose one from the list.</span></div>}
    <aside className="detail-rail">{current ? <><div className="supplier-card"><div className="supplier-avatar">{(current.supplier_name || 'S').slice(0,1).toUpperCase()}</div><small>SUPPLIER</small><h2>{current.supplier_name || 'Supplier details'}</h2><p>{current.supplier_gstin || 'GSTIN not entered'}</p><span className={`badge ${current.status}`}>{current.status.replace('_',' ')}</span></div><div className="rail-card"><h3>Invoice summary</h3><div className="rail-row"><span>Invoice number</span><b>{current.invoice_number || '—'}</b></div><div className="rail-row"><span>Invoice date</span><b>{current.invoice_date || '—'}</b></div><div className="rail-row"><span>Subtotal</span><b>{fmt(current.subtotal, current.currency)}</b></div><div className="rail-row"><span>Tax / interest</span><b>{fmt(current.tax_amount, current.currency)}</b></div><div className="rail-total"><span>Total due</span><b>{fmt(current.total, current.currency)}</b></div></div><div className="rail-card source-meta"><h3>Source file</h3><FileCheck2 size={17}/><span>{current.source_name || 'No file name'}</span></div><div className="rail-card audit-card"><h3><Clock3 size={15}/> Activity history</h3>{invoiceEvents.length ? invoiceEvents.map(event => <div className="audit-event" key={event.id}><b>{event.event_type.replaceAll('_',' ')}</b><small>{event.details}</small><small>{event.actor} · {new Date(event.created_at).toLocaleString()}</small></div>) : <p>No activity recorded yet.</p>}</div></> : <div className="rail-card rail-empty"><FileCheck2 size={22}/><h3>Invoice details</h3><p>Select an invoice to see supplier information and totals.</p></div>}</aside></section>
    </>}
    {activeView === 'notifications' && <section className="notification-page"><div className="notification-page-head"><div><div className="kicker">WORKSPACE</div><h1>Notifications</h1><p>Read and unread account and invoice updates stay available here.</p></div><button type="button" onClick={() => void markAllNotificationsRead()} disabled={!notifications.some(item => !item.read_at)}>Mark all read</button></div><div className="notification-page-list">{notifications.length ? notifications.map(item => <button type="button" className={`notification-page-item ${item.read_at ? 'read' : 'unread'}`} key={item.id} onClick={() => void openNotification(item)}><span className="notification-symbol"><Bell size={16}/></span><span className="notification-page-copy"><span><b>{item.title}</b><time>{new Date(item.created_at).toLocaleString()}</time></span><small>{item.message}</small></span><i>{item.read_at ? 'Read' : 'Unread'}</i></button>) : <div className="notification-page-empty"><Bell size={22}/><b>No notifications yet</b><span>New account and invoice updates will appear here.</span></div>}</div></section>}
    </div></main></div>
}
