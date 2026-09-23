import { lazy, Suspense } from 'react'
import { DATA, SESSIONS, COMBINES, shotCount } from './lib/data'
import { WarmupProvider, routeHref, useRoute, useWarmup } from './lib/app-state'
import { fmtDate } from './lib/stats'

const ReportView = lazy(() => import('./views/ReportView'))
const DailyView = lazy(() => import('./views/DailyView'))
const ExploreView = lazy(() => import('./views/ExploreView'))

function WarmupControl() {
  const { mode, n, setMode, setN } = useWarmup()
  return (
    <div className="warmup-ctl" title="How warm-up shots are removed before any statistic is computed">
      <span>Warm-ups</span>
      <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option value="tagged">tagged (loftiest club rule + notes)</option>
        <option value="first">first N shots of every club</option>
        <option value="none">keep everything</option>
      </select>
      {mode === 'first' && <input type="number" min={0} max={20} value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value) || 0))} />}
    </div>
  )
}

function Shell() {
  const [route, navigate] = useRoute()
  const link = (view: 'report' | 'daily' | 'explore', label: string, key: string) => (
    <a href={routeHref({ view })} className={route.view === view ? 'active' : ''}>
      {label} <span className="k">{key}</span>
    </a>
  )
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark">TM</div>
          <div>
            <span className="name">Trackman</span>
            <span className="sub">Nick Alonso · {SESSIONS.length} sessions · {shotCount()} shots · {COMBINES.length} Combines</span>
          </div>
        </div>
        <nav className="nav">
          {link('report', 'Report', '1')}
          {link('daily', 'What changed', '2')}
          {link('explore', 'Explore', '3')}
        </nav>
        <div className="spacer" />
        <WarmupControl />
      </header>
      <main>
        <Suspense fallback={<div className="empty">Loading…</div>}>
          {route.view === 'report' && <ReportView />}
          {route.view === 'daily' && <DailyView param={route.param} navigate={(d) => navigate({ view: 'daily', param: d })} />}
          {route.view === 'explore' && <ExploreView param={route.param} navigate={(t) => navigate({ view: 'explore', param: t })} openDay={(d) => navigate({ view: 'daily', param: d })} />}
        </Suspense>
      </main>
      <footer className="footer">
        <span>Data extracted {fmtDate(DATA.generated)} from Trackman PDF exports. Distances in yards, speeds in mph, Combine side and from-pin in feet. Side and curve are signed +right / −left.</span>
        <span>Refresh: drop a PDF in reports/, run scripts/extract_reports.py, push.</span>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <WarmupProvider>
      <Shell />
    </WarmupProvider>
  )
}
