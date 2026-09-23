import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WarmupMode } from './stats'

// ---------- Hash routing:  #/report   #/daily/2026-09-23   #/explore/trends ----------

export interface Route {
  view: 'report' | 'daily' | 'explore'
  param?: string
}

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [view, param] = h.split('/')
  if (view === 'daily' || view === 'explore') return { view, param: param || undefined }
  return { view: 'report' }
}

export function routeHref(r: Route): string {
  return '#/' + r.view + (r.param ? '/' + r.param : '')
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = useCallback((r: Route) => {
    window.location.hash = routeHref(r)
  }, [])
  return [route, navigate]
}

// ---------- Warm-up rule shared by every view ----------

interface WarmupState {
  mode: WarmupMode
  n: number
  setMode: (m: WarmupMode) => void
  setN: (n: number) => void
}

const WarmupCtx = createContext<WarmupState>({ mode: 'tagged', n: 4, setMode: () => {}, setN: () => {} })

export function WarmupProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('warmup')
    if (q === 'none') return { mode: 'none' as WarmupMode, n: 4 }
    if (q && /^\d+$/.test(q)) return { mode: 'first' as WarmupMode, n: Number(q) }
    return { mode: 'tagged' as WarmupMode, n: 4 }
  }, [])
  const [mode, setMode] = useState<WarmupMode>(initial.mode)
  const [n, setN] = useState<number>(initial.n)
  const value = useMemo(() => ({ mode, n, setMode, setN }), [mode, n])
  return <WarmupCtx.Provider value={value}>{children}</WarmupCtx.Provider>
}

export const useWarmup = () => useContext(WarmupCtx)
