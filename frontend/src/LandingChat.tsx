import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { API, apiFetch } from './api'
import './landing-chat.css'

type Message = { role: 'assistant' | 'user'; text: string }

const projectGuide = [
  {
    topics: ['invoice', 'review', 'approval', 'approve', 'workflow', 'accounting'],
    answer: 'The invoice desk accepts a PDF or supported image, keeps the source document beside the details, and lets an accounts reviewer check the supplier, dates, tax, totals, and line items. A named person must approve it. Posting to an external accounting system is not connected yet.',
  },
  {
    topics: ['total', 'calculation', 'math', 'mistake', 'match', 'mismatch', 'amount', 'tax'],
    answer: 'The review screen calculates line-item subtotal plus tax and compares it with the entered invoice total. It also checks quantity × rate and line totals against subtotal. You can use the calculated total, but still verify the source before approval.',
  },
  {
    topics: ['ocr', 'paddle', 'easyocr', 'handwriting', 'read', 'extract'],
    answer: 'When you choose “Read with OCR,” the configured Groq Qwen vision model reads the invoice PDF or image and places field suggestions into editable invoice details. PaddleOCR and EasyOCR are local fallbacks if Groq is unavailable. Handwriting can be uncertain, so verify each value against the source before saving or approving.',
  },
  {
    topics: ['lead', 'crm', 'pipeline', 'customer', 'prospect', 'follow', 'sales'],
    answer: 'The CRM lets you record a company, contact details, lead source, industry, estimated value, notes, and follow-up date. Leads move through New, Contacted, Qualified, Proposal, Won, or Lost.',
  },
  {
    topics: ['live', 'online', 'cloud', 'production', 'deploy', 'host'],
    answer: 'The current project is not production-live. It still needs real authentication, workspace-level access controls, managed PostgreSQL, private cloud file storage, background OCR jobs, HTTPS hosting, and production monitoring. See the project’s live-readiness plan for the full list.',
  },
  {
    topics: ['data', 'secure', 'security', 'privacy', 'password', 'login', 'signup', 'sign in'],
    answer: 'The current sign-in screen is a local preview, not real account security. The project must add a real identity provider and workspace-level authorization before it handles customer financial documents online.',
  },
  {
    topics: ['price', 'cost', 'pricing', 'free'],
    answer: 'Pricing has not been configured in this project yet. Hosting, OCR compute, storage, email, and any AI provider may have separate costs once you choose production services.',
  },
]

const suggestions = ['How does invoice review work?', 'How is the total checked?', 'Can it read handwriting?', 'Is the app live yet?']

function answerFromProject(question: string) {
  const query = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  const words = new Set(query.split(/\s+/).filter(word => word.length > 2))
  const ranked = projectGuide.map(item => ({
    item,
    score: item.topics.reduce((score, topic) => score + (words.has(topic) || query.includes(topic) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score)
  if (!ranked[0]?.score) return 'I can answer about TechJays leads, invoice review, total checks, OCR, and launch readiness. Ask me about one of those areas, or send the AI API details when you are ready to connect it.'
  return ranked[0].item.answer
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <span key={index}>{part}</span>
  })
}

function renderMessage(text: string) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index++; continue }
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) { blocks.push(<h4 key={`h-${index}`}>{renderInline(heading[1])}</h4>); index++; continue }
    const listMatch = line.match(/^(?:[-+*]\s+|\d+[.)]\s+)(.+)$/)
    if (listMatch) {
      const ordered = /^\d+[.)]\s+/.test(line)
      const items: ReactNode[] = []
      while (index < lines.length) {
        const itemLine = lines[index].trim().match(/^(?:[-+*]\s+|\d+[.)]\s+)(.+)$/)
        if (!itemLine || ordered !== /^\d+[.)]\s+/.test(lines[index].trim())) break
        items.push(<li key={`i-${index}`}>{renderInline(itemLine[1])}</li>)
        index++
      }
      blocks.push(ordered ? <ol key={`ol-${index}`}>{items}</ol> : <ul key={`ul-${index}`}>{items}</ul>)
      continue
    }
    const paragraph = [line]
    index++
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index].trim()) && !/^(?:[-+*]\s+|\d+[.)]\s+)/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim())
      index++
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(' '))}</p>)
  }
  return <div className="landing-chat-rich">{blocks}</div>
}

export default function LandingChat() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Hi! I can answer questions about the TechJays accounting CRM, invoice checks, OCR, and what is needed to launch it.' },
  ])
  const [typing, setTyping] = useState(false)
  const [groqConfigured, setGroqConfigured] = useState(false)
  const [groqModel, setGroqModel] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, open])

  useEffect(() => {
    apiFetch(`${API}/api/chat/status`).then(response => response.ok ? response.json() : null).then(status => {
      if (status) { setGroqConfigured(Boolean(status.configured)); setGroqModel(status.model || '') }
    }).catch(() => setGroqConfigured(false))
  }, [])

  async function send(text = input) {
    const question = text.trim()
    if (!question || typing) return
    const conversation = [...messages, { role: 'user' as const, text: question }]
    setMessages(conversation)
    setInput('')
    setTyping(true)
    try {
      const response = await apiFetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation.slice(-10).map(message => ({ role: message.role, content: message.text })) }),
      })
      const result = await response.json()
      if (!response.ok || typeof result.reply !== 'string') throw new Error('Groq is unavailable')
      setGroqConfigured(true); setGroqModel(result.model || '')
      setMessages(current => [...current, { role: 'assistant', text: result.reply }])
    } catch {
      setGroqConfigured(false)
      setMessages(current => [...current, { role: 'assistant', text: answerFromProject(question) }])
    } finally { setTyping(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    send()
  }

  return <div className="landing-chat">
    {open && <section className="landing-chat-panel" aria-label="TechJays project assistant">
      <header className="landing-chat-header"><span className="chat-brand-icon"><Sparkles size={16}/></span><div><b>TechJays assistant</b><small>{groqConfigured ? `Groq AI · ${groqModel}` : 'Project guide · Groq API not configured'}</small></div><button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><X size={17}/></button></header>
      <div className="landing-chat-body" ref={bodyRef} aria-live="polite">
        {messages.map((message, index) => <div className={`landing-chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.role === 'assistant' ? renderMessage(message.text) : <span>{message.text}</span>}</div>)}
        {typing && <div className="landing-chat-message assistant"><span className="chat-typing"><i/><i/><i/></span></div>}
        {messages.length === 1 && <div className="landing-chat-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div>}
      </div>
      <form className="landing-chat-form" onSubmit={submit}><input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder="Ask about the project..." aria-label="Ask the project assistant"/><button type="submit" disabled={!input.trim() || typing} aria-label="Send message"><Send size={16}/></button></form>
      <div className="landing-chat-foot">Project-grounded answers · Verify accounting decisions with a reviewer.</div>
    </section>}
    <button className={`landing-chat-launcher ${open ? 'is-open' : ''}`} type="button" onClick={() => { setOpen(value => !value); window.setTimeout(() => inputRef.current?.focus(), 0) }} aria-label={open ? 'Close project assistant' : 'Open project assistant'} aria-expanded={open}>
      {open ? <X size={21}/> : <><MessageCircle size={20}/><span>Ask about TechJays</span></>}
    </button>
  </div>
}
