import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/overlay.css'
import OverlayToastApp from './OverlayToastApp'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <OverlayToastApp />
  </React.StrictMode>
)
