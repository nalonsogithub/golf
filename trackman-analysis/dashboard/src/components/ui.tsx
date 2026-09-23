import type { ReactNode } from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import type { Verdict } from '../lib/changes'
import { fmt, num } from '../lib/stats'
import { clubColor, prettyClub } from '../lib/clubs'

export function Card({ children, className = '', accent }: { children: ReactNode; className?: string; accent?: Verdict }) {
  const a = accent && accent !== 'none' ? ` accent-${accent}` : ''
  return <div className={`card rise ${className}${a}`}>{children}</div>
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {sub && <span className="sub">{sub}</span>}
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  )
}

export function Chip({ kind = 'neutral', children, title }: { kind?: Verdict | 'record' | 'info' | 'club'; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${kind === 'none' ? 'neutral' : kind}`} title={title}>
      {children}
    </span>
  )
}

export function ClubChip({ club }: { club: string }) {
  return (
    <span className="chip club">
      <span className="dot" style={{ background: clubColor(club) }} /> {prettyClub(club)}
    </span>
  )
}

/** Signed delta with colour by verdict. */
export function Delta({ value, decimals = 1, unit = '', verdict = 'neutral', pct = false }: { value: number | null | undefined; decimals?: number; unit?: string; verdict?: Verdict; pct?: boolean }) {
  if (!num(value)) return <span className="chip neutral">n/a</span>
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '•'
  return (
    <span className={`chip ${verdict === 'none' ? 'neutral' : verdict}`}>
      {arrow} {fmt(Math.abs(value), decimals)}
      {pct ? ' %' : unit ? (unit === '°' ? unit : ' ' + unit) : ''}
    </span>
  )
}

export function Sparkline({ data, color = '#f26a1b', width = 90, height = 30 }: { data: (number | null)[]; color?: string; width?: number; height?: number }) {
  const pts = data.map((v, i) => ({ i, v })).filter((p) => num(p.v))
  if (pts.length < 2) return null
  return (
    <div className="spark" style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Kpi({ label, value, unit, foot, spark, sparkColor, decimals = 1 }: { label: string; value: number | string | null | undefined; unit?: string; foot?: ReactNode; spark?: (number | null)[]; sparkColor?: string; decimals?: number }) {
  return (
    <div className="card kpi rise">
      <div className="label">{label}</div>
      <div className="value">
        {typeof value === 'string' ? value : fmt(value, decimals)}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {foot && <div className="foot">{foot}</div>}
      {spark && <Sparkline data={spark} color={sparkColor} />}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode; color?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.color && <span className="dot" style={{ background: o.color }} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
