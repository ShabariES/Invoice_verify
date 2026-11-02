import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, CalendarClock, Check, CircleDollarSign, FileCheck2, FileText, Menu, Pause, Play, RotateCcw, ScanSearch, ShieldCheck, Target, Upload, UsersRound, Workflow } from 'lucide-react'
import LandingChat from './LandingChat'

const Background3D = lazy(() => import('./Background3D'))

const walkthrough = [
  { group: 'CRM', title: 'Capture a lead', view: 'New lead saved', detail: 'Company, contact, source, and opportunity value are kept together.', benefit: 'Your team starts with useful context instead of scattered notes.', icon: UsersRound, stages: ['New', 'Contacted', 'Qualified', 'Proposal'] },
  { group: 'CRM', title: 'Set the next step', view: 'Follow-up scheduled', detail: 'Add a note and a follow-up date, then keep the lead moving through its stage.', benefit: 'The next action is visible, so promising conversations are less likely to go cold.', icon: CalendarClock, stages: ['New', 'Contacted', 'Qualified', 'Proposal'] },
  { group: 'ACCOUNTING', title: 'Upload an invoice', view: 'Invoice added to review', detail: 'Bring a supplier PDF or supported image into the review inbox.', benefit: 'Documents have a clear place to go as soon as they arrive.', icon: Upload, stages: ['Uploaded', 'Review', 'Details', 'Approve'] },
  { group: 'ACCOUNTING', title: 'Check and complete', view: 'Details checked against source', detail: 'View the original document while entering supplier, invoice, tax, and line-item details.', benefit: 'Keep the source close while checking amounts and correcting invoice data.', icon: ScanSearch, stages: ['Uploaded', 'Review', 'Details', 'Approve'] },
  { group: 'ACCOUNTING', title: 'Approve with confidence', view: 'Human approval recorded', detail: 'Save the draft, then record the reviewer when the invoice is ready to approve.', benefit: 'Approval stays deliberate and traceable to a named reviewer.', icon: ShieldCheck, stages: ['Uploaded', 'Review', 'Details', 'Approved'] },
]

const workflows = [
  {
    id: 'crm', eyebrow: 'CUSTOMER RELATIONSHIPS', title: 'Lead pipeline', description: 'Keep every prospect, conversation, and next action moving in the same view.', icon: UsersRound,
    steps: [
      { title: 'Capture the lead', description: 'Save the company, contact details, source, industry, and estimated opportunity.', icon: UsersRound },
      { title: 'Qualify the opportunity', description: 'Move it through New, Contacted, Qualified, and Proposal as the conversation progresses.', icon: Target },
      { title: 'Plan the next touch', description: 'Add notes and a follow-up date so the next action stays visible.', icon: CalendarClock },
      { title: 'Record the outcome', description: 'Mark the lead Won or Lost and keep the final status in your pipeline.', icon: BadgeCheck },
    ],
  },
  {
    id: 'accounting', eyebrow: 'SUPPLIER OPERATIONS', title: 'Invoice review', description: 'Move supplier documents from upload to a deliberate, reviewable decision.', icon: FileCheck2,
    steps: [
      { title: 'Upload a document', description: 'Add a supplier invoice as a PDF or supported image to the review inbox.', icon: Upload },
      { title: 'Check the source', description: 'View the original pages while you verify supplier and invoice information.', icon: ScanSearch },
      { title: 'Complete the details', description: 'Enter invoice number, date, tax, totals, and line items; save a draft if needed.', icon: FileText },
      { title: 'Review and approve', description: 'Record who approved it. The system requires a human review before approval.', icon: ShieldCheck },
    ],
  },
]

export default function LandingPage({ onRegister, onLogin }: { onRegister: () => void; onLogin: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [demoStep, setDemoStep] = useState(0)
  const [demoPlaying, setDemoPlaying] = useState(false)
  const landingRef = useRef<HTMLElement>(null)
  const currentDemo = walkthrough[demoStep]
  const DemoIcon = currentDemo.icon
  const activeStageIndex = [0, 1, 0, 2, 3][demoStep]
  const completedStageCount = demoStep === walkthrough.length - 1 ? 3 : activeStageIndex

  useEffect(() => {
    const root = landingRef.current
    if (!root || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const targets = root.querySelectorAll<HTMLElement>('[data-reveal]')
    if (!targets.length) return
    root.classList.add('motion-ready')
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -36px 0px' })
    targets.forEach(target => observer.observe(target))
    return () => { observer.disconnect(); root.classList.remove('motion-ready') }
  }, [])

  useEffect(() => {
    if (!demoPlaying) return
    if (demoStep === walkthrough.length - 1) { setDemoPlaying(false); return }
    const timer = window.setTimeout(() => setDemoStep(step => Math.min(step + 1, walkthrough.length - 1)), 4600)
    return () => window.clearTimeout(timer)
  }, [demoPlaying, demoStep])

  function playDemo() {
    if (demoPlaying) { setDemoPlaying(false); return }
    if (demoStep === walkthrough.length - 1) setDemoStep(0)
    setDemoPlaying(true)
  }

  function selectDemoStep(step: number) {
    setDemoStep(step)
    setDemoPlaying(false)
  }

  return <main className="public-landing" ref={landingRef}>
    <section className="landing-hero" id="top">
      <Suspense fallback={null}><Background3D /></Suspense>
      <header className={`landing-nav ${menuOpen ? 'menu-open' : ''}`}><a className="landing-brand" href="#top" aria-label="TechJays home"><span className="brand-mark"><FileCheck2 size={19}/></span><span><b>TECHJAYS</b><small>ACCOUNTING CRM</small></span></a><nav className="landing-links"><a href="#features" onClick={()=>setMenuOpen(false)}>Features</a><a href="#workflow" onClick={()=>setMenuOpen(false)}>How it works</a><a href="#product-tour" onClick={()=>setMenuOpen(false)}>Product tour</a><a href="#accounting" onClick={()=>setMenuOpen(false)}>Accounting</a><button onClick={()=>{setMenuOpen(false);onLogin()}}>Log in</button><button className="mobile-start" onClick={()=>{setMenuOpen(false);onRegister()}}>Get started <ArrowUpRight size={14}/></button></nav><div className="landing-nav-actions"><button className="landing-login" onClick={onLogin}>Log in</button><button className="landing-nav-cta" onClick={onRegister}>Get started <ArrowUpRight size={15}/></button></div><button className="landing-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={()=>setMenuOpen(open=>!open)}><Menu size={19}/></button></header>

      <div className="landing-copy"><span className="landing-eyebrow"><i/> ONE WORKSPACE. BETTER BUSINESS.</span><h1>Your numbers,<br/>and your <em>next move.</em></h1><p>Bring customer relationships and accounting workflows together. Track leads, manage invoices, and keep every follow-up moving.</p><div className="landing-actions"><button className="landing-primary" onClick={onRegister}>Create your workspace <ArrowRight size={16}/></button><a className="landing-watch" href="#product-tour"><span><Play size={13}/></span> Watch the product tour</a></div><div className="landing-proof"><span><Check size={13}/> Lead pipeline</span><i/><span><Check size={13}/> Invoice review</span><i/><span><Check size={13}/> Follow-ups</span></div></div>

      <div className="landing-art" aria-label="Preview of the TechJays accounting CRM dashboard"><div className="landing-app-window"><div className="preview-window-bar"><span className="preview-logo"><i/> TECHJAYS <small>WORKSPACE</small></span><span className="preview-account">AC&nbsp; Accounts</span></div><div className="preview-window-body"><aside className="preview-sidebar"><b>T</b><span>OVERVIEW</span><span className="selected"><BarChart3 size={13}/> Dashboard</span><span><UsersRound size={13}/> Leads</span><span><FileText size={13}/> Invoices</span></aside><div className="preview-main"><div className="preview-heading"><div><small>WORKSPACE / OVERVIEW</small><b>Good morning, Asha</b></div><span><i/> All systems ready</span></div><div className="preview-metrics"><div><small>Active leads</small><b>24</b><i>+ 4 this month</i></div><div><small>Invoice review</small><b>08</b><i>3 need attention</i></div><div><small>Pipeline value</small><b>₹4.8L</b><i>Across open leads</i></div></div><div className="preview-lower"><div className="preview-chart"><div className="preview-module-head"><b>Pipeline activity</b><small>Last 6 months</small></div><div className="preview-chart-bars">{[38,55,46,74,60,91,68,84].map((height,index)=><i key={index} style={{height:`${height}%`}}/>)}</div><div className="preview-chart-axis"><span>JUN</span><span>JUL</span><span>AUG</span><span>SEP</span></div></div><div className="preview-invoices"><div className="preview-module-head"><b>Recent invoices</b><small>View all ↗</small></div><div><i>NS</i><span><b>Northstar Supplies</b><small>INV-2048 · Today</small></span><em>Review</em></div><div><i>AC</i><span><b>Acme Components</b><small>INV-2047 · Yesterday</small></span><em className="done">Approved</em></div></div></div></div></div></div><div className="preview-caption"><span><i/> PRODUCT PREVIEW</span><span>CRM + ACCOUNTING</span></div><div className="floating-card lead-float"><span className="float-icon"><CalendarClock size={16}/></span><span><small>NEXT FOLLOW-UP</small><b>Today · Northstar Supplies</b><em>Qualified opportunity</em></span><ArrowUpRight size={15}/></div><div className="floating-card invoice-float"><span className="float-icon orange-icon"><FileCheck2 size={16}/></span><span><small>INVOICE REVIEW</small><b>INV-2048 <i>Needs review</i></b><em>Source document attached</em></span><BadgeCheck size={17}/></div></div>
      <a className="landing-scroll-cue" href="#features">SCROLL TO EXPLORE <ArrowDown size={13}/></a>
      <span className="hero-index">01 / 03</span>
    </section>

    <section className="landing-features" id="features"><div className="features-intro" data-reveal><span className="landing-eyebrow"><i/> MADE FOR THE WAY BUSINESS WORKS</span><h2>Every connection<br/>has a <em>next step.</em></h2><p>From first conversation to final payment, keep the context close and the work moving.</p><button className="features-link" onClick={onRegister}>See it in your workspace <ArrowRight size={15}/></button></div><div className="feature-cards"><article className="feature-card" data-reveal><span className="feature-number">01</span><span className="feature-icon"><UsersRound size={19}/></span><h3>Lead relationships</h3><p>Capture prospects, qualify opportunities, and make every follow-up visible to your team.</p><span className="feature-foot">CAPTURE · QUALIFY · CONVERT <ArrowUpRight size={13}/></span></article><article className="feature-card" data-reveal><span className="feature-number">02</span><span className="feature-icon"><FileCheck2 size={19}/></span><h3>Invoice workflow</h3><p>Review supplier invoices, correct details, and keep approvals connected to the source.</p><span className="feature-foot">UPLOAD · REVIEW · APPROVE <ArrowUpRight size={13}/></span></article><article className="feature-card" id="accounting" data-reveal><span className="feature-number">03</span><span className="feature-icon"><Workflow size={19}/></span><h3>One business record</h3><p>Keep company details, financial activity, and next actions together as relationships grow.</p><span className="feature-foot">PEOPLE · BOOKS · ACTIVITY <ArrowUpRight size={13}/></span></article></div></section>

    <section className="landing-workflow" id="workflow">
      <div className="pipeline-intro" data-reveal><span className="landing-eyebrow"><i/> HOW THE WORKSPACE WORKS</span><h2>Two clear pipelines.<br/><em>One calmer workday.</em></h2><p>Manage customer opportunities in CRM and supplier invoices in accounting. Each process has its own stages, details, and next action.</p></div>
      <div className="pipeline-tracks">{workflows.map(track => { const TrackIcon = track.icon; return <article className={`pipeline-track-card pipeline-${track.id}`} key={track.id} data-reveal>
        <header className="pipeline-track-heading"><span className="pipeline-track-icon"><TrackIcon size={19}/></span><div><small>{track.eyebrow}</small><h3>{track.title}</h3><p>{track.description}</p></div></header>
        <ol className="pipeline-sequence">{track.steps.map((step, index) => { const StepIcon = step.icon; return <li key={step.title}>
          <span className="pipeline-node"><StepIcon size={16}/></span><div className="pipeline-step-copy"><small>STEP 0{index + 1}</small><b>{step.title}</b><p>{step.description}</p></div>
        </li> })}</ol>
      </article> })}</div>
      <div className="pipeline-promise" data-reveal><span className="promise-icon"><ShieldCheck size={19}/></span><div><small>BUILT FOR CONTROL</small><b>Important decisions stay reviewable.</b><p>Invoice documents remain available during review, and approval requires an identified human reviewer.</p></div><button onClick={onRegister}>Explore your workspace <ArrowRight size={15}/></button></div>
    </section>

    <section className="landing-demo" id="product-tour">
      <div className="demo-intro" data-reveal><span className="landing-eyebrow"><i/> A QUICK PRODUCT TOUR</span><h2>See the work move<br/><em>from step to step.</em></h2><p>Play the walkthrough or choose a step to see how the CRM and invoice desk help keep everyday work organized.</p></div>
      <div className="demo-player" data-reveal>
        <div className="demo-display">
          <div className="demo-window" key={demoStep}>
            <div className="demo-window-bar"><span className="demo-window-brand"><i/> TECHJAYS <small>WORKSPACE</small></span><span className="demo-window-account">AC&nbsp; Accounts</span></div>
            <div className="demo-app-layout">
              <aside className="demo-app-sidebar"><b>T</b><span className="demo-side-label">WORKSPACE</span><span className={currentDemo.group === 'CRM' ? 'selected' : ''}><UsersRound size={13}/> Leads</span><span className={currentDemo.group === 'ACCOUNTING' ? 'selected' : ''}><FileText size={13}/> Invoices</span></aside>
              <div className="demo-app-content"><div className="demo-app-kicker">{currentDemo.group} WORKFLOW</div><h3>{currentDemo.view}</h3><p>{currentDemo.detail}</p>
                <div className="demo-stage-flow">{currentDemo.stages.map((stage, index) => <div className={`demo-stage ${index < completedStageCount ? 'complete' : ''} ${index === activeStageIndex ? 'current' : ''}`} key={stage}><span>{index < completedStageCount ? <Check size={11}/> : index + 1}</span><small>{stage}</small></div>)}</div>
                <div className="demo-record-card"><span className="demo-record-icon"><DemoIcon size={17}/></span><div><small>{currentDemo.group === 'CRM' ? 'RELATIONSHIP RECORD' : 'INVOICE RECORD'}</small><b>{demoStep === 0 ? 'Northstar Supplies' : demoStep === 1 ? 'Follow-up · 12 Nov' : demoStep === 2 ? 'INV-2048 · New upload' : demoStep === 3 ? 'Supplier details · ₹24,850' : 'Reviewed by Asha Mehta'}</b></div><span className="demo-record-status">{demoStep === 4 ? 'Approved' : demoStep === 1 ? 'Due soon' : 'In progress'}</span></div>
                <div className="demo-usefulness"><span><Check size={13}/></span><div><small>WHY IT HELPS</small><b>{currentDemo.benefit}</b></div></div>
              </div>
            </div>
          </div>
          <div className="demo-display-footer"><span><i/> PRODUCT WALKTHROUGH</span><span>0{demoStep + 1} / 0{walkthrough.length}</span></div>
        </div>
        <aside className="demo-controls"><div className="demo-controls-top"><span>THE WORKFLOW</span><span>5 STEPS · ABOUT 25 SECONDS</span></div><h3>{currentDemo.title}</h3><p>{currentDemo.detail}</p>
          <ol className="demo-timeline">{walkthrough.map((step, index) => { const StepIcon = step.icon; return <li key={step.title}><button className={index === demoStep ? 'active' : index < demoStep ? 'done' : ''} aria-current={index === demoStep ? 'step' : undefined} onClick={() => selectDemoStep(index)}><span className="timeline-icon">{index < demoStep ? <Check size={13}/> : <StepIcon size={13}/>}</span><span><small>{step.group}</small><b>{step.title}</b></span><span className="timeline-index">0{index + 1}</span></button></li> })}</ol>
          <div className="demo-playback"><button className="demo-play-button" onClick={playDemo} aria-label={demoPlaying ? 'Pause walkthrough' : demoStep === walkthrough.length - 1 ? 'Replay walkthrough' : 'Play walkthrough'}>{demoPlaying ? <Pause size={16}/> : demoStep === walkthrough.length - 1 ? <RotateCcw size={15}/> : <Play size={15}/>}<span>{demoPlaying ? 'Pause tour' : demoStep === walkthrough.length - 1 ? 'Replay tour' : 'Play tour'}</span></button><div className="demo-nav-buttons"><button onClick={() => selectDemoStep(Math.max(0, demoStep - 1))} disabled={demoStep === 0} aria-label="Previous step"><ArrowLeft size={15}/></button><button onClick={() => selectDemoStep(Math.min(walkthrough.length - 1, demoStep + 1))} disabled={demoStep === walkthrough.length - 1} aria-label="Next step"><ArrowRight size={15}/></button></div></div>
          <div className="demo-progress" role="progressbar" aria-label="Walkthrough progress" aria-valuemin={1} aria-valuemax={walkthrough.length} aria-valuenow={demoStep + 1}><span style={{ width: `${((demoStep + 1) / walkthrough.length) * 100}%` }}/></div>
        </aside>
      </div>
    </section>

    <section className="landing-cta"><div data-reveal><span className="landing-eyebrow"><i/> YOUR BUSINESS, IN ONE CLEAR VIEW</span><h2>Make room for the<br/>next opportunity.</h2></div><button className="landing-primary" onClick={onRegister}>Create your free workspace <ArrowRight size={16}/></button><span className="cta-stamp"><ShieldCheck size={15}/> LOCAL-FIRST WORKSPACE</span></section>
    <footer className="landing-footer"><a className="landing-brand" href="#top"><span className="brand-mark"><FileCheck2 size={18}/></span><span><b>TECHJAYS</b><small>ACCOUNTING CRM</small></span></a><span>RELATIONSHIPS IN VIEW. BOOKS IN ORDER.</span><button onClick={onLogin}>Already have a workspace? <u>Log in</u></button></footer>
    <LandingChat/>
  </main>
}
