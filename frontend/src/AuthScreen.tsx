import { FormEvent, useState } from 'react'
import { ArrowRight, Check, Eye, EyeOff, FileCheck2, LockKeyhole, Mail, MessageCircle, Phone, ReceiptText, ScanSearch, ShieldCheck, Upload, UserRound } from 'lucide-react'
import { API, apiFetch } from './api'

type AuthMode = 'signup' | 'signin'
const ADMIN_WHATSAPP_NUMBER = '916369035633'
export type AuthUser = { id: number; name: string; company_name?: string; email: string; role: 'lead' | 'admin'; approval_status?: 'pending' | 'approved' | 'rejected' }

export default function AuthScreen({ onEnter, onBack, initialMode = 'signup' }: { onEnter: (user: AuthUser) => void; onBack?: () => void; initialMode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState('')
  const [whatsAppContactUrl, setWhatsAppContactUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    setWhatsAppContactUrl('')
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
        const text = `Hello TechJays Admin, I just requested workspace access. Name: ${body.name}. Company: ${body.company_name}. Email: ${body.email}. Please review my request.`
        setWhatsAppContactUrl(`https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`)
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
      <div className="story-copy"><span className="auth-eyebrow">ACCOUNTING, WITH THE FULL PICTURE</span><h1>Every invoice<br/>has a <em>clear story.</em></h1><p>See the original document, verified totals, and review status together in one focused workspace.</p></div>
      <div className="auth-workspace-visual" aria-label="Illustration of an invoice review workspace"><div className="auth-visual-orbit orbit-one"/><div className="auth-visual-orbit orbit-two"/><article className="auth-invoice-sheet"><header><span><FileCheck2 size={16}/></span><b>INVOICE REVIEW</b><em>INV-2048</em></header><div className="invoice-paper-title"><small>ACME SUPPLY CO.</small><b>Tax invoice</b><span>03 Nov 2026 · #2048</span></div><div className="invoice-paper-lines"><i/><i/><i/><i/></div><div className="invoice-paper-items"><div><span>Consulting services</span><b>₹22,000</b></div><div><span>Tax · 13%</span><b>₹2,850</b></div></div><div className="invoice-paper-total"><span>Total due</span><b>₹24,850</b></div></article><div className="auth-float-card amount-check"><span><Check size={15}/></span><div><b>Amounts reconcile</b><small>Difference ₹0.00</small></div></div><div className="auth-float-card human-check"><span><ShieldCheck size={15}/></span><div><b>Human review required</b><small>Ready for approval</small></div></div><div className="auth-visual-caption"><i/> SOURCE DOCUMENT <span>DETAIL CHECKS</span><span>REVIEW</span></div></div>
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
          {whatsAppContactUrl && <a className="auth-whatsapp-link" href={whatsAppContactUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={15}/> Contact admin on WhatsApp</a>}
        </form>
        <div className="auth-switch">{mode === 'signup' ? 'Already have an account?' : 'New to Invoice Desk?'} <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setNotice(''); setWhatsAppContactUrl('') }}>{mode === 'signup' ? 'Sign in' : 'Create an account'}</button></div>
        <div className="auth-local-note"><span/> ADMIN REVIEW <i/> New Lead accounts require approval</div>
      </div>
      <p className="auth-legal">By continuing, you agree to use this local invoice review workspace responsibly.</p>
    </section>
  </main>
}
