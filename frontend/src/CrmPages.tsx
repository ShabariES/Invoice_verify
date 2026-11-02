import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, CalendarClock, Check, ChevronRight, CircleDollarSign, Filter, Plus, Search, ShieldCheck, Sparkles, Target, UsersRound, X } from 'lucide-react'
import { API, apiFetch } from './api'

export type Lead = {
  id: number
  company_name: string
  contact_name: string
  email: string
  phone: string
  source: string
  industry: string
  estimated_value: number | string
  status: string
  next_follow_up: string | null
  notes: string
  created_at: string
  updated_at: string
  approval_status: 'pending' | 'approved' | 'rejected'
  approved_by: string
  rejection_reason: string
}

const stages = [
  { id: 'new', label: 'New', color: '#b97583' },
  { id: 'contacted', label: 'Contacted', color: '#8b2945' },
  { id: 'qualified', label: 'Qualified', color: '#6d0626' },
  { id: 'proposal', label: 'Proposal', color: '#4a0c20' },
  { id: 'won', label: 'Won', color: '#557b5d' },
  { id: 'lost', label: 'Lost', color: '#897a7b' },
]
type LeadFilter = 'all' | 'active' | 'qualified' | 'won' | 'followups' | string
const money = (amount: number | string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount || 0))
const shortDate = (date: string | null) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Not scheduled'

export function CrmHome({ leads, invoiceCount, canViewAccounting, onOpenLeads, onOpenInvoices, onCreateLead }: { leads: Lead[]; invoiceCount: number; canViewAccounting: boolean; onOpenLeads: (filter?: LeadFilter) => void; onOpenInvoices: () => void; onCreateLead: () => void }) {
  const active = leads.filter(lead => !['won', 'lost'].includes(lead.status))
  const qualified = leads.filter(lead => ['qualified', 'proposal'].includes(lead.status))
  const pipelineValue = active.reduce((total, lead) => total + Number(lead.estimated_value || 0), 0)
  const followUps = leads.filter(lead => lead.next_follow_up && lead.next_follow_up >= new Date().toISOString().slice(0, 10) && !['won', 'lost'].includes(lead.status))
  const maxStage = Math.max(...stages.map(stage => leads.filter(lead => lead.status === stage.id).length), 1)
  const latest = [...leads].sort((a, b) => b.id - a.id).slice(0, 5)

  return <div className="crm-page crm-home">
    <section className="crm-welcome">
      <div className="crm-welcome-copy"><span className="crm-eyebrow"><Sparkles size={13}/> ACCOUNTING CRM</span><h1>Build stronger business relationships.</h1><p>Keep customers, prospects, and financial activity connected in one workspace.</p><div className="crm-welcome-actions"><button className="crm-primary" onClick={onCreateLead}><Plus size={16}/> Add a lead</button><button className="crm-secondary" onClick={() => onOpenLeads()}>View lead pipeline <ArrowRight size={15}/></button></div></div>
      <div className="crm-welcome-art"><div className="crm-orbit orbit-one"/><div className="crm-orbit orbit-two"/><div className="crm-art-card art-card-main"><span className="art-icon"><UsersRound size={18}/></span><div><small>Relationship pipeline</small><b>{leads.length} {leads.length === 1 ? 'lead' : 'leads'} in view</b></div><ArrowUpRight size={16}/></div><div className="crm-art-card art-card-mini"><span><CircleDollarSign size={15}/></span><div><small>Open opportunity</small><b>{money(pipelineValue)}</b></div></div><span className="crm-art-dot dot-a"/><span className="crm-art-dot dot-b"/></div>
    </section>

    <div className="crm-metrics">
      <button type="button" className="crm-metric" onClick={() => onOpenLeads('active')} aria-label={`Show ${active.length} active leads`}><span className="metric-icon icon-blue"><UsersRound size={17}/></span><small>Active leads</small><b>{active.length}</b><span className="metric-note"><ArrowUpRight size={13}/> In progress</span><span className="metric-hint">View leads <ArrowRight size={12}/></span></button>
      <button type="button" className="crm-metric" onClick={() => onOpenLeads('qualified')} aria-label={`Show ${qualified.length} qualified opportunities`}><span className="metric-icon icon-indigo"><Target size={17}/></span><small>Qualified opportunities</small><b>{qualified.length}</b><span className="metric-note">Ready for the next step</span><span className="metric-hint">View leads <ArrowRight size={12}/></span></button>
      <button type="button" className="crm-metric" onClick={() => onOpenLeads('active')} aria-label={`Show open pipeline leads worth ${money(pipelineValue)}`}><span className="metric-icon icon-sky"><CircleDollarSign size={17}/></span><small>Open pipeline value</small><b>{money(pipelineValue)}</b><span className="metric-note">Estimated lead value</span><span className="metric-hint">View leads <ArrowRight size={12}/></span></button>
      <button type="button" className="crm-metric" onClick={() => onOpenLeads('followups')} aria-label={`Show ${followUps.length} leads with follow-ups due`}><span className="metric-icon icon-mint"><CalendarClock size={17}/></span><small>Follow-ups due</small><b>{followUps.length}</b><span className="metric-note">Keep conversations moving</span><span className="metric-hint">View leads <ArrowRight size={12}/></span></button>
    </div>

    <div className="crm-home-grid">
      <section className="crm-panel pipeline-panel"><div className="crm-panel-head"><div><span className="crm-eyebrow">SALES OVERVIEW</span><h2>Lead pipeline</h2><p>Move each opportunity forward with a clear next step.</p></div><button className="crm-icon-button" title="View pipeline" onClick={() => onOpenLeads()}><ChevronRight size={17}/></button></div>
        <div className="pipeline-stages">{stages.slice(0, 5).map(stage => { const count = leads.filter(lead => lead.status === stage.id).length; return <button type="button" className="pipeline-stage" key={stage.id} onClick={() => onOpenLeads(stage.id)} aria-label={`Show ${count} ${stage.label.toLowerCase()} leads`}><div className="stage-top"><span><i style={{ background: stage.color }}/>{stage.label}</span><b>{count}</b></div><div className="stage-track"><i style={{ width: `${(count / maxStage) * 100}%`, background: stage.color }}/></div></button> })}</div>
        <div className="pipeline-foot"><span><i/> {active.length} opportunities still active</span><button onClick={() => onOpenLeads()}>Manage leads <ArrowRight size={14}/></button></div>
      </section>
      <section className="crm-panel recent-panel"><div className="crm-panel-head"><div><span className="crm-eyebrow">RELATIONSHIPS</span><h2>Recently added</h2><p>Your latest prospects and customers.</p></div><button className="crm-text-button" onClick={() => onOpenLeads()}>See all <ArrowRight size={14}/></button></div>
        {latest.length ? <div className="recent-list">{latest.map(lead => <button className="recent-lead" key={lead.id} onClick={() => onOpenLeads(lead.status)} aria-label={`View ${lead.company_name} in the ${stageLabel(lead.status)} stage`}><span className="lead-avatar">{(lead.company_name || 'L').slice(0, 1).toUpperCase()}</span><span className="recent-copy"><b>{lead.company_name}</b><small>{lead.contact_name || lead.email || 'Contact not added'}</small></span><span className={`lead-status status-${lead.status}`}>{stageLabel(lead.status)}</span><ChevronRight size={15}/></button>)}</div> : <div className="crm-empty"><span className="crm-empty-icon"><UsersRound size={19}/></span><b>Your pipeline starts here</b><p>Add a prospect to keep their contact details, opportunity, and follow-up together.</p><button className="crm-secondary" onClick={onCreateLead}>Create your first lead <ArrowRight size={14}/></button></div>}
      </section>
    </div>

    {canViewAccounting && <button type="button" className="crm-accounting-strip" onClick={onOpenInvoices}><span className="accounting-icon"><BriefcaseBusiness size={18}/></span><div><small>ACCOUNTING WORKSPACE</small><b>{invoiceCount} invoices in your books</b><p>Customer and supplier relationships can grow alongside the financial record.</p></div><span className="accounting-link"><Check size={14}/> View invoices <ArrowRight size={13}/></span></button>}
  </div>
}

export function LeadsPage({ leads, onLeadsChange, createRequest, query, initialFilter = 'all', isAdmin = false }: { leads: Lead[]; onLeadsChange: (leads: Lead[]) => void; createRequest: number; query: string; initialFilter?: string; isAdmin?: boolean }) {
  const [accessRequests, setAccessRequests] = useState<Array<{ id: number; name: string; email: string; created_at?: string; approval_status: string }>>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Lead | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [summaryFilter, setSummaryFilter] = useState<LeadFilter>('all')
  const [approvalOnly, setApprovalOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [approvalMessage, setApprovalMessage] = useState('')
  const [approvalBusy, setApprovalBusy] = useState<number | null>(null)
  useEffect(() => {
    if (!isAdmin) return
    void apiFetch(`${API}/api/admin/access-requests`).then(async response => {
      if (!response.ok) throw new Error('Could not load account requests')
      setAccessRequests(await response.json())
    }).catch(() => setApprovalMessage('Could not load pending account access requests.'))
  }, [isAdmin])
  const [form, setForm] = useState({ company_name: '', contact_name: '', email: '', phone: '', source: 'Website', industry: '', estimated_value: '', status: 'new', next_follow_up: '', notes: '' })
  useEffect(() => { if (createRequest) { setEditing(null); setForm(emptyForm()); setError(''); setModal(true) } }, [createRequest])
  useEffect(() => {
    setApprovalOnly(false)
    if (['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'].includes(initialFilter)) { setStatusFilter(initialFilter); setSummaryFilter('all') }
    else { setStatusFilter('all'); setSummaryFilter(initialFilter) }
  }, [initialFilter])
  const visible = useMemo(() => leads.filter(lead => {
    const summaryMatch = summaryFilter === 'all' || (summaryFilter === 'active' && !['won', 'lost'].includes(lead.status)) || (summaryFilter === 'qualified' && ['qualified', 'proposal'].includes(lead.status)) || (summaryFilter === 'won' && lead.status === 'won') || (summaryFilter === 'followups' && !!lead.next_follow_up && lead.next_follow_up >= new Date().toISOString().slice(0, 10) && !['won', 'lost'].includes(lead.status))
    return (!approvalOnly || lead.approval_status === 'pending') && summaryMatch && (statusFilter === 'all' || lead.status === statusFilter) && `${lead.company_name} ${lead.contact_name} ${lead.email} ${lead.industry}`.toLowerCase().includes(query.toLowerCase())
  }), [leads, statusFilter, summaryFilter, approvalOnly, query])
  const chooseSummary = (filter: LeadFilter) => { setApprovalOnly(false); setSummaryFilter(filter); setStatusFilter('all') }
  const openNew = () => { setEditing(null); setForm(emptyForm()); setError(''); setModal(true) }
  const openEdit = (lead: Lead) => { setEditing(lead); setForm({ ...lead, estimated_value: String(lead.estimated_value ?? ''), next_follow_up: lead.next_follow_up || '' }); setError(''); setModal(true) }
  const setField = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    const payload = { ...form, estimated_value: Number(form.estimated_value || 0), next_follow_up: form.next_follow_up || null }
    try {
      const response = await apiFetch(editing ? `${API}/api/leads/${editing.id}` : `${API}/api/leads`, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not save this lead.')
      onLeadsChange(editing ? leads.map(lead => lead.id === data.id ? data : lead) : [data, ...leads])
      setModal(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect to the local CRM API.') }
    finally { setSaving(false) }
  }
  async function decideLead(lead: Lead, action: 'approved' | 'rejected') {
    const reason = action === 'rejected' ? window.prompt('Reason for rejecting this lead (optional):') : ''
    if (reason === null) return
    setApprovalBusy(lead.id); setApprovalMessage('')
    try {
      const response = await apiFetch(`${API}/api/leads/${lead.id}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not review this lead.')
      onLeadsChange(leads.map(item => item.id === data.id ? data : item))
      setApprovalMessage(action === 'approved' ? `${lead.company_name} approved.` : `${lead.company_name} sent back for changes.`)
    } catch (cause) { setApprovalMessage(cause instanceof Error ? cause.message : 'Could not connect to the CRM API.') }
    finally { setApprovalBusy(null) }
  }
  async function decideAccess(userId: number, action: 'approved' | 'rejected') {
    const reason = action === 'rejected' ? window.prompt('Reason for rejecting this access request (optional):') : ''
    if (reason === null) return
    setApprovalBusy(userId); setApprovalMessage('')
    try {
      const response = await apiFetch(`${API}/api/admin/users/${userId}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not review this access request.')
      setAccessRequests(items => items.filter(item => item.id !== userId))
      setApprovalMessage(action === 'approved' ? `${data.name} can now sign in.` : `${data.name}'s access request was rejected.`)
    } catch (cause) { setApprovalMessage(cause instanceof Error ? cause.message : 'Could not connect to the account service.') }
    finally { setApprovalBusy(null) }
  }
  const activeCount = leads.filter(lead => !['won', 'lost'].includes(lead.status)).length

  return <div className="crm-page leads-page">
    <section className="crm-page-heading"><div><span className="crm-eyebrow">{isAdmin ? 'ADMIN · CUSTOMER RELATIONSHIPS' : 'CUSTOMER RELATIONSHIPS'}</span><h1>{isAdmin ? 'Lead approvals' : 'Leads'}</h1><p>{isAdmin ? 'Review new submissions, approve qualified records, and manage the full lead pipeline.' : 'Capture prospects, understand their needs, and keep the next conversation on track.'}</p></div><button className="crm-primary" onClick={openNew}><Plus size={16}/> Add lead</button></section>
    {approvalMessage && <p className="lead-approval-notice" role="status">{approvalMessage}</p>}
    {isAdmin && <section className="crm-panel access-requests-panel"><div className="crm-panel-head"><div><span className="crm-eyebrow">ACCOUNT SECURITY</span><h2>Workspace access requests</h2><p>New Lead accounts can sign in only after you approve them.</p></div><span className="access-request-count">{accessRequests.length} pending</span></div>{accessRequests.length ? <div className="access-request-list">{accessRequests.map(account => <article className="access-request-row" key={account.id}><span className="access-request-icon"><ShieldCheck size={17}/></span><span className="access-request-person"><b>{account.name}</b><small>{account.email}{account.created_at ? ` · Requested ${new Date(account.created_at).toLocaleDateString()}` : ''}</small></span><span className="lead-approval-actions"><button type="button" disabled={approvalBusy === account.id} onClick={() => void decideAccess(account.id, 'approved')}><Check size={13}/> Approve access</button><button type="button" disabled={approvalBusy === account.id} onClick={() => void decideAccess(account.id, 'rejected')}>Reject</button></span></article>)}</div> : <div className="access-request-empty"><Check size={15}/> No pending account requests</div>}</section>}
    {isAdmin && <button type="button" className={`admin-approval-summary ${approvalOnly ? 'selected' : ''}`} aria-pressed={approvalOnly} onClick={() => { setStatusFilter('all'); setSummaryFilter('all'); setApprovalOnly(!approvalOnly) }}><small>Awaiting admin review</small><b>{leads.filter(lead => lead.approval_status === 'pending').length}</b><span>{approvalOnly ? 'Showing leads awaiting approval.' : 'Click to review new lead submissions.'}</span></button>}
    <div className="lead-summary" aria-label="Lead summaries">
      <button type="button" className={summaryFilter === 'all' ? 'selected' : ''} aria-pressed={summaryFilter === 'all'} onClick={() => chooseSummary('all')}><small>Total leads</small><b>{leads.length}</b><span>Show every lead <ArrowRight size={12}/></span></button>
      <button type="button" className={summaryFilter === 'active' ? 'selected' : ''} aria-pressed={summaryFilter === 'active'} onClick={() => chooseSummary('active')}><small>Active pipeline</small><b>{activeCount}</b><span>Show active leads <ArrowRight size={12}/></span></button>
      <button type="button" className={summaryFilter === 'qualified' ? 'selected' : ''} aria-pressed={summaryFilter === 'qualified'} onClick={() => chooseSummary('qualified')}><small>Qualified</small><b>{leads.filter(lead => ['qualified', 'proposal'].includes(lead.status)).length}</b><span>Show qualified leads <ArrowRight size={12}/></span></button>
      <button type="button" className={summaryFilter === 'won' ? 'selected' : ''} aria-pressed={summaryFilter === 'won'} onClick={() => chooseSummary('won')}><small>Won</small><b>{leads.filter(lead => lead.status === 'won').length}</b><span>Show won leads <ArrowRight size={12}/></span></button>
    </div>
    <section className="crm-panel leads-table-panel"><div className="leads-toolbar"><div><h2>{approvalOnly ? 'Leads awaiting approval' : summaryFilter === 'all' && statusFilter === 'all' ? 'All leads' : summaryFilter === 'active' ? 'Active pipeline' : summaryFilter === 'qualified' ? 'Qualified opportunities' : summaryFilter === 'won' ? 'Won leads' : summaryFilter === 'followups' ? 'Follow-ups due' : `${stageLabel(statusFilter)} leads`}</h2><span>Showing {visible.length} of {leads.length} {leads.length === 1 ? 'lead' : 'leads'}</span></div><label className="lead-filter"><Filter size={15}/><select value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setSummaryFilter('all'); setApprovalOnly(false) }}><option value="all">All stages</option>{stages.map(stage => <option value={stage.id} key={stage.id}>{stage.label}</option>)}</select></label></div>
      {visible.length ? <div className="leads-table-scroll"><table className="leads-table"><thead><tr><th>COMPANY / CONTACT</th><th>STAGE</th><th>SOURCE</th><th>EST. VALUE</th><th>FOLLOW-UP</th><th>{isAdmin ? 'ADMIN REVIEW' : 'APPROVAL'}</th></tr></thead><tbody>{visible.map(lead => <tr key={lead.id} onClick={() => openEdit(lead)}><td><span className="table-company"><i>{lead.company_name.slice(0, 1).toUpperCase()}</i><span><b>{lead.company_name}</b><small>{lead.contact_name || lead.email || 'No contact details'}</small></span></span></td><td><span className={`lead-status status-${lead.status}`}>{stageLabel(lead.status)}</span></td><td>{lead.source}</td><td className="table-value">{money(lead.estimated_value)}</td><td>{shortDate(lead.next_follow_up)}</td><td>{isAdmin && lead.approval_status === 'pending' ? <span className="lead-approval-actions"><button type="button" disabled={approvalBusy === lead.id} onClick={event => { event.stopPropagation(); void decideLead(lead, 'approved') }}><Check size={13}/> Approve</button><button type="button" disabled={approvalBusy === lead.id} onClick={event => { event.stopPropagation(); void decideLead(lead, 'rejected') }}>Reject</button></span> : <span className={`lead-approval-state ${lead.approval_status}`}>{lead.approval_status}{lead.approval_status === 'approved' && lead.approved_by ? ` · ${lead.approved_by}` : ''}</span>}</td></tr>)}</tbody></table></div> : <div className="leads-empty"><span className="crm-empty-icon"><Search size={18}/></span><b>{leads.length ? 'No leads match this view' : 'No leads yet'}</b><p>{leads.length ? 'Try a different search or stage filter.' : 'Add a lead to start building your relationship pipeline.'}</p>{!leads.length && <button className="crm-secondary" onClick={openNew}><Plus size={14}/> Add your first lead</button>}</div>}
    </section>
    {modal && <div className="crm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(false) }}><section className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="lead-form-title"><div className="crm-modal-head"><div><span className="crm-eyebrow">LEAD DETAILS</span><h2 id="lead-form-title">{editing ? 'Update lead' : 'Add a lead'}</h2><p>Keep the relationship record and next step in one place.</p></div><button className="crm-icon-button" onClick={() => setModal(false)} aria-label="Close lead form"><X size={17}/></button></div>
      {editing?.approval_status === 'rejected' && <p className="lead-rejection-reason">Admin feedback: {editing.rejection_reason || 'Please review the lead details and resubmit.'} Saving your changes will send it for approval again.</p>}
      <form className="lead-form" onSubmit={submit}><label>Company name<input required maxLength={240} value={form.company_name} onChange={event => setField('company_name', event.target.value)} placeholder="e.g. Acme Industries" autoFocus/></label><label>Contact person<input maxLength={160} value={form.contact_name} onChange={event => setField('contact_name', event.target.value)} placeholder="Full name"/></label><label>Email address<input type="email" maxLength={254} value={form.email} onChange={event => setField('email', event.target.value)} placeholder="name@company.com"/></label><label>Phone number<input type="tel" maxLength={40} value={form.phone} onChange={event => setField('phone', event.target.value)} placeholder="+91 98765 43210"/></label><label>Lead source<select value={form.source} onChange={event => setField('source', event.target.value)}>{['Website', 'Referral', 'Social media', 'Event', 'Partner', 'Outbound', 'Other'].map(source => <option key={source}>{source}</option>)}</select></label><label>Industry<input maxLength={120} value={form.industry} onChange={event => setField('industry', event.target.value)} placeholder="e.g. Manufacturing"/></label><label>Estimated opportunity (₹)<input type="number" min="0" step="1000" value={form.estimated_value} onChange={event => setField('estimated_value', event.target.value)} placeholder="0"/></label><label>Next follow-up<input type="date" value={form.next_follow_up} onChange={event => setField('next_follow_up', event.target.value)}/></label><label>Pipeline stage<select value={form.status} onChange={event => setField('status', event.target.value)}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label><label className="lead-form-wide">Notes<textarea rows={3} maxLength={4000} value={form.notes} onChange={event => setField('notes', event.target.value)} placeholder="What does this business need? Add useful context for the next conversation."/></label>
        {error && <p className="lead-form-error" role="alert">{error}</p>}<div className="lead-form-actions"><button type="button" className="crm-secondary" onClick={() => setModal(false)}>Cancel</button><button type="submit" className="crm-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save lead'} <ArrowRight size={15}/></button></div>
      </form></section></div>}
  </div>
}

function emptyForm() { return { company_name: '', contact_name: '', email: '', phone: '', source: 'Website', industry: '', estimated_value: '', status: 'new', next_follow_up: '', notes: '' } }
function stageLabel(status: string) { return stages.find(stage => stage.id === status)?.label || status }
