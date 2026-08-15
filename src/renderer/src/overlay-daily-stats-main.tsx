import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/overlay.css'
import OverlayDailyStatsApp from './OverlayDailyStatsApp'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <OverlayDailyStatsApp />
  </React.StrictMode>
)
