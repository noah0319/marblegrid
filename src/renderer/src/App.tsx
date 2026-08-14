import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Layout, { type Page } from './components/Layout'
import Dashboard from './pages/Dashboard'
import LeaderboardPage from './pages/LeaderboardPage'
import MapsPage from './pages/MapsPage'
import Settings from './pages/Settings'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')

  return (
    <Layout page={page} onNavigate={setPage}>
      {/* mode="wait": the old page fully fades out before the new one fades
          in, so nothing overlaps mid-transition (UI polish pass: "more
          motion & life" applied to page switches, not just the overlay). */}
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        >
          {page === 'dashboard' && <Dashboard />}
          {page === 'leaderboard' && <LeaderboardPage />}
          {page === 'maps' && <MapsPage />}
          {page === 'settings' && <Settings />}
        </motion.div>
      </AnimatePresence>
    </Layout>
  )
}
