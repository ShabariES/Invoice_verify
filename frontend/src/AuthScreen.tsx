import { FormEvent, useState } from 'react'
import { ArrowRight, Check, Eye, EyeOff, FileCheck2, LockKeyhole, Mail, Phone, ReceiptText, ScanSearch, ShieldCheck, Upload, UserRound } from 'lucide-react'
import { API, apiFetch } from './api'

type AuthMode = 'signup' | 'signin'
export type AuthUser = { id: number; name: string; company_name?: string; email: string; role: 'lead' | 'admin'; approval_status?: 'pending' | 'approved' | 'rejected' }

export default function AuthScreen({ onEnter, onBack, initialMode = 'signup' }: { onEnter: (user: AuthUser) => void; onBack?: () => void; initialMode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    setBusy(true)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const body = mode === 'signup'
      ? { name: String(form.get('name') || ''), company_name: String(form.get('company_name') || ''), email: String(form.get('email') || ''), password: String(form.get('password') || ''), phone: String(form.get('phone') || ''), whatsapp_opt_in: form.get('whatsapp_opt_in') === 'on' }
      : { email: String(form.get('email') || ''), password: String(form.get('password') || '') }
    try {
      const response = await apiFetch(`${API}/api/auth/${mode === 'signup' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not sign in.')
      if (mode === 'signup' && data.approval_status === 'pending') {
        setNotice('Your access request has been sent to an Admin. You can sign in after it is approved.')
        formElement.reset()
        return
      }
      onEnter(data as AuthUser)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not connect to the account service.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-story">
      <div className="auth-brand"><span className="auth-brand-icon"><FileCheck2 size={20}/></span><span><b>TECHJAYS</b><small>INVOICE DESK</small></span></div>
      <div className="story-copy"><span className="auth-eyebrow">SUPPLIER INVOICE WORKSPACE</span><h1>Invoices, made<br/>easy to review.</h1><p>Collect supplier documents, review the details, and approve with confidence.</p><div className="workflow-steps" aria-label="Invoice workflow"><div><span><Upload size={14}/></span><b>Upload</b></div><i/><div><span><ScanSearch size={14}/></span><b>Review</b></div><i/><div><span><Check size={14}/></span><b>Approve</b></div></div></div>
      <div className="auth-value-panel" aria-label="Invoice review capabilities">
        <div className="auth-value-heading"><span><ReceiptText size={18}/></span><div><small>INVOICE DESK</small><b>Review with the full context</b></div><em><i/> HUMAN REVIEW</em></div>
        <div className="auth-value-list">
          <article><span><FileCheck2 size={16}/></span><div><b>Keep the source close</b><p>Open the original document while checking invoice details.</p></div></article>
          <article><span><ReceiptText size={16}/></span><div><b>Complete details before approval</b><p>Review the supplier, totals, tax, and line items together.</p></div></article>
          <article><span><ShieldCheck size={16}/></span><div><b>Record a human decision</b><p>Approval requires a named reviewer, not an automatic pass.</p></div></article>
        </div>
        <div className="auth-value-foot"><Check size={14}/> Save a draft and return when the invoice is ready.</div>
      </div>
      <div className="story-foot"><span className="foot-dot"/> LOCAL WORKSPACE · HUMAN REVIEW</div>
    </section>

    <section className="auth-form-side">
      <div className="auth-mobile-brand"><FileCheck2 size={19}/> TECHJAYS <span>INVOICE DESK</span></div>
      <div className="auth-card">
        {onBack && <button className="auth-back" type="button" onClick={onBack}>← Back to home</button>}
        <div className="auth-heading"><span className="form-brand"><ReceiptText size={18}/> <b>TECHJAYS</b><i/> INVOICE DESK</span><span className="form-eyebrow">{mode === 'signup' ? 'REQUEST WORKSPACE ACCESS' : 'CONTINUE YOUR WORKFLOW'}</span><h2>{mode === 'signup' ? <>Request access<br/>to your workspace.</> : <>Welcome back.</>}</h2><p>{mode === 'signup' ? 'An Admin will review your request before you can sign in.' : 'Sign in to continue your invoice review.'}</p></div>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <label>Your name<span className="auth-input"><UserRound size={17}/><input name="name" autoComplete="name" placeholder="e.g. Asha Mehta" minLength={1} maxLength={160} required/></span></label>}
          {mode === 'signup' && <label>Company name<span className="auth-input"><ReceiptText size={17}/><input name="company_name" autoComplete="organization" placeholder="e.g. Acme Industries" minLength={1} maxLength={240} required/></span></label>}
          <label>Email address<span className="auth-input"><Mail size={17}/><input name="email" type="email" autoComplete="email" placeholder="you@company.com" required/></span></label>
          {mode === 'signup' && <label>Phone for WhatsApp updates <small>(optional)</small><span className="auth-input"><Phone size={17}/><input name="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" maxLength={32}/></span></label>}
          {mode === 'signup' && <label className="whatsapp-opt-in"><input type="checkbox" name="whatsapp_opt_in"/> I agree to receive account and workflow notifications on WhatsApp.</label>}
          <label>Password<span className="auth-input"><LockKeyhole size={17}/><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 10 : 1} placeholder={mode === 'signup' ? 'At least 10 characters' : 'Enter your password'} required/><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
          {mode === 'signin' && <div className="auth-options"><label className="remember"><input type="checkbox"/> Keep me signed in</label><span>Secure session</span></div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Request access' : 'Sign in'}<ArrowRight size={17}/></button>
          {notice && <p className="auth-notice" role="status">{notice}</p>}
        </form>
        <div className="auth-switch">{mode === 'signup' ? 'Already have an account?' : 'New to Invoice Desk?'} <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setNotice('') }}>{mode === 'signup' ? 'Sign in' : 'Create an account'}</button></div>
        <div className="auth-local-note"><span/> ADMIN REVIEW <i/> New Lead accounts require approval</div>
      </div>
      <p className="auth-legal">By continuing, you agree to use this local invoice review workspace responsibly.</p>
    </section>
  </main>
}
