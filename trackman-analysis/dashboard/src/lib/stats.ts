import type { Shot, Session, ClubBlock } from '../types'

export type WarmupMode = 'tagged' | 'none' | 'first'

export interface MetricDef {
  key: string
  label: string
  short: string
  unit: string
  decimals: number
  /** Which direction is an improvement for the *mean*: 'up', 'down', 'zero' (closer to zero), 'none' */
  better: 'up' | 'down' | 'zero' | 'none'
  /** Whether a lower spread (SD) is meaningful for this metric */
  spreadMatters: boolean
}

export const METRICS: Record<string, MetricDef> = {
  club_speed: { key: 'club_speed', label: 'Club speed', short: 'Club spd', unit: 'mph', decimals: 1, better: 'up', spreadMatters: false },
  ball_speed: { key: 'ball_speed', label: 'Ball speed', short: 'Ball spd', unit: 'mph', decimals: 1, better: 'up', spreadMatters: false },
  smash: { key: 'smash', label: 'Smash factor', short: 'Smash', unit: '', decimals: 2, better: 'up', spreadMatters: true },
  attack_angle: { key: 'attack_angle', label: 'Attack angle', short: 'Attack', unit: '°', decimals: 1, better: 'none', spreadMatters: true },
  club_path: { key: 'club_path', label: 'Club path', short: 'Path', unit: '°', decimals: 1, better: 'zero', spreadMatters: true },
  face_angle: { key: 'face_angle', label: 'Face angle', short: 'Face', unit: '°', decimals: 1, better: 'zero', spreadMatters: true },
  face_to_path: { key: 'face_to_path', label: 'Face to path', short: 'F2P', unit: '°', decimals: 1, better: 'zero', spreadMatters: true },
  launch_angle: { key: 'launch_angle', label: 'Launch angle', short: 'Launch', unit: '°', decimals: 1, better: 'none', spreadMatters: true },
  dynamic_loft: { key: 'dynamic_loft', label: 'Dynamic loft', short: 'Dyn loft', unit: '°', decimals: 1, better: 'none', spreadMatters: true },
  spin_rate: { key: 'spin_rate', label: 'Spin rate', short: 'Spin', unit: 'rpm', decimals: 0, better: 'none', spreadMatters: true },
  carry: { key: 'carry', label: 'Carry', short: 'Carry', unit: 'yds', decimals: 1, better: 'up', spreadMatters: true },
  total: { key: 'total', label: 'Total', short: 'Total', unit: 'yds', decimals: 1, better: 'up', spreadMatters: true },
  side: { key: 'side', label: 'Side (+R / −L)', short: 'Side', unit: 'yds', decimals: 1, better: 'zero', spreadMatters: true },
  curve: { key: 'curve', label: 'Curve (+R / −L)', short: 'Curve', unit: 'yds', decimals: 1, better: 'zero', spreadMatters: true },
}

export const METRIC_ORDER = ['carry', 'total', 'side', 'curve', 'ball_speed', 'club_speed', 'smash', 'attack_angle', 'club_path', 'face_angle', 'face_to_path', 'launch_angle', 'dynamic_loft', 'spin_rate']

export const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function values(shots: Shot[], key: string): number[] {
  return shots.map((s) => s[key]).filter(num)
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export function sd(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = mean(xs)!
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return null
  const mx = mean(xs.slice(0, n))!
  const my = mean(ys.slice(0, n))!
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

export interface Summary {
  n: number
  mean: Record<string, number | null>
  sd: Record<string, number | null>
  median: Record<string, number | null>
  /** % of shots with |lateral| > 15 yds, using side when present else curve */
  pctBig: number | null
  /** % of shots finishing left of target */
  pctLeft: number | null
  lateralKey: 'side' | 'curve' | null
}

export function lateralKey(shots: Shot[]): 'side' | 'curve' | null {
  if (values(shots, 'side').length) return 'side'
  if (values(shots, 'curve').length) return 'curve'
  return null
}

export function summarize(shots: Shot[]): Summary {
  const out: Summary = { n: shots.length, mean: {}, sd: {}, median: {}, pctBig: null, pctLeft: null, lateralKey: lateralKey(shots) }
  for (const k of Object.keys(METRICS)) {
    const v = values(shots, k)
    out.mean[k] = mean(v)
    out.sd[k] = sd(v)
    out.median[k] = median(v)
  }
  if (out.lateralKey) {
    const v = values(shots, out.lateralKey)
    if (v.length) {
      out.pctBig = (100 * v.filter((x) => Math.abs(x) > 15).length) / v.length
      out.pctLeft = (100 * v.filter((x) => x < 0).length) / v.length
    }
  }
  return out
}

/** Apply the global warm-up rule to a club's shot list. */
export function analysed(shots: Shot[], mode: WarmupMode, n: number): Shot[] {
  if (mode === 'none') return shots
  if (mode === 'first') return shots.slice(n)
  return shots.filter((s) => !s.warmup)
}

export function warmupCount(shots: Shot[], mode: WarmupMode, n: number): number {
  return shots.length - analysed(shots, mode, n).length
}

export interface ClubSession {
  session: Session
  block: ClubBlock
  shots: Shot[]
  raw: Shot[]
  summary: Summary
}

/** Flatten sessions into (session, club) rows with the warm-up rule applied. */
export function clubSessions(sessions: Session[], mode: WarmupMode, n: number): ClubSession[] {
  const rows: ClubSession[] = []
  for (const session of sessions) {
    for (const block of session.clubs) {
      const shots = analysed(block.shots, mode, n)
      rows.push({ session, block, shots, raw: block.shots, summary: summarize(shots) })
    }
  }
  return rows
}

export function fmt(v: number | null | undefined, decimals = 1, opts: { sign?: boolean; unit?: string } = {}): string {
  if (!num(v)) return '–'
  const s = v.toFixed(decimals)
  const signed = opts.sign && v > 0 ? '+' + s : s
  return opts.unit ? `${signed}${opts.unit === '°' || opts.unit === '' ? opts.unit : ' ' + opts.unit}` : signed
}

export function fmtDate(iso: string, style: 'short' | 'long' | 'month' = 'short'): string {
  const d = new Date(iso + 'T00:00:00')
  if (style === 'long') return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  if (style === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const ts = (iso: string) => new Date(iso + 'T00:00:00').getTime()

export function quarter(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`
}

export function daysBetween(a: string, b: string): number {
  return Math.round((ts(b) - ts(a)) / 86_400_000)
}
