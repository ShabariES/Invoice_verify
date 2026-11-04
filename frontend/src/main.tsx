import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './theme.css'
import './auth.css'
import './neon.css'
import './landing.css'
import './professional.css'
import './cherry.css'
import './blue-workspace.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
