import { useState } from 'react'
import Layout, { type Page } from './components/Layout'
import Dashboard from './pages/Dashboard'
import LeaderboardPage from './pages/LeaderboardPage'
import Settings from './pages/Settings'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')

  return (
    <Layout page={page} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard />}
      {page === 'leaderboard' && <LeaderboardPage />}
      {page === 'settings' && <Settings />}
    </Layout>
  )
}
