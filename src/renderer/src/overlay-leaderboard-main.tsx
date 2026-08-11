import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/overlay.css'
import OverlayLeaderboardApp from './OverlayLeaderboardApp'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <OverlayLeaderboardApp />
  </React.StrictMode>
)
