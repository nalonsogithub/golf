import type { Key, ReactNode } from 'react'
import {
  CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Legend,
} from 'recharts'
import { fmt, fmtDate, num } from '../lib/stats'
import { clubColor, prettyClub } from '../lib/clubs'

export const AXIS = '#5d6b7e'
export const GRID = '#243040'
const tick = { fill: '#8b9bb0', fontSize: 11 }

export function ChartTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="chart-title">
      <div>
        <h3>{title}</h3>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

interface TipRow { label: string; value: string; color?: string }
export function TipBox({ title, rows }: { title: ReactNode; rows: TipRow[] }) {
  return (
    <div className="tip">
      <div className="t">{title}</div>
      {rows.map((r, i) => (
        <div className="r" key={i}>
          <span style={{ color: r.color }}>{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  )
}

// ---------- Trend over time (one line per club) ----------

export interface TrendPoint { t: number; date: string; y: number | null; n?: number; extra?: string }
export interface TrendSeries { id: string; label?: string; color?: string; points: TrendPoint[] }

export function TrendChart({ series, unit = '', decimals = 1, height = 280, reverse = false, refY, domain }: { series: TrendSeries[]; unit?: string; decimals?: number; height?: number; reverse?: boolean; refY?: number; domain?: [number | 'auto', number | 'auto'] }) {
  // merge into one row per timestamp
  const rows = new Map<number, Record<string, unknown>>()
  for (const s of series) {
    for (const p of s.points) {
      if (!num(p.y)) continue
      const r = rows.get(p.t) ?? { t: p.t, date: p.date }
      r[s.id] = p.y
      r[s.id + '__n'] = p.n
      r[s.id + '__x'] = p.extra
      rows.set(p.t, r)
    }
  }
  const data = [...rows.values()].sort((a, b) => (a.t as number) - (b.t as number))
  if (!data.length) return <div className="empty small">No data for this selection.</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(v) => fmtDate(new Date(v).toISOString().slice(0, 10), 'month')} tick={tick} stroke={AXIS} minTickGap={40} />
        <YAxis tick={tick} stroke={AXIS} reversed={reverse} domain={domain ?? ['auto', 'auto']} tickFormatter={(v) => fmt(v, decimals === 0 ? 0 : decimals > 1 ? 2 : 0)} width={48} />
        {num(refY) && <ReferenceLine y={refY} stroke={AXIS} strokeDasharray="4 4" />}
        <Tooltip
          cursor={{ stroke: AXIS }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const row = payload[0].payload as Record<string, unknown>
            return (
              <TipBox
                title={fmtDate(row.date as string)}
                rows={payload.filter((p) => num(p.value)).map((p) => {
                  const s = series.find((x) => x.id === p.dataKey)!
                  const n = row[s.id + '__n'] as number | undefined
                  const x = row[s.id + '__x'] as string | undefined
                  return { label: s.label ?? prettyClub(s.id), value: `${fmt(p.value as number, decimals)}${unit === '°' ? '°' : unit ? ' ' + unit : ''}${n ? ` · n=${n}` : ''}${x ? ` · ${x}` : ''}`, color: p.color as string }
                })}
              />
            )
          }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: '#8b9bb0' }} formatter={(v) => series.find((s) => s.id === v)?.label ?? prettyClub(v)} />}
        {series.map((s) => (
          <Line key={s.id} type="linear" dataKey={s.id} stroke={s.color ?? clubColor(s.id)} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: s.color ?? clubColor(s.id) }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ---------- Dispersion (side vs carry) ----------

export interface ShotPoint { x: number; y: number; shot?: number; warm?: boolean; label?: string; date?: string }
export interface ScatterSeries { id: string; label?: string; color?: string; points: ShotPoint[]; ghost?: boolean; r?: number }

function ShotDot(props: { cx?: number; cy?: number; payload?: ShotPoint; fill?: string; ghost?: boolean; r?: number }) {
  const { cx = 0, cy = 0, payload, fill = '#fff', ghost, r = 5 } = props
  if (ghost) return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.18} stroke="none" />
  if (payload?.warm) return <circle cx={cx} cy={cy} r={r} fill="#0b0f14" stroke={fill} strokeWidth={1.5} strokeDasharray="2 2" />
  return <circle cx={cx} cy={cy} r={r} fill={fill} stroke="#0b0f14" strokeWidth={1} />
}

export function DispersionChart({ series, xLabel = 'Side (yds, +R / −L)', yLabel = 'Carry (yds)', height = 320, band = 15, xDomain, yDomain, xUnit = 'yds', yUnit = 'yds', xIsLateral = true, yZero = false }: { series: ScatterSeries[]; xLabel?: string; yLabel?: string; height?: number; band?: number | null; xDomain?: [number, number]; yDomain?: [number | 'auto', number | 'auto']; xUnit?: string; yUnit?: string; xIsLateral?: boolean; yZero?: boolean }) {
  const all = series.flatMap((s) => s.points)
  if (!all.length) return <div className="empty small">No shots with both values.</div>
  const maxAbs = Math.max(20, ...all.map((p) => Math.abs(p.x))) * 1.08
  const xd: [number, number] = xDomain ?? (xIsLateral ? [-Math.ceil(maxAbs / 5) * 5, Math.ceil(maxAbs / 5) * 5] : [Math.floor(Math.min(...all.map((p) => p.x))), Math.ceil(Math.max(...all.map((p) => p.x)))])
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: -4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        {xIsLateral && num(band) && <ReferenceArea x1={-band} x2={band} fill="#22c55e" fillOpacity={0.05} stroke="none" />}
        <XAxis dataKey="x" type="number" domain={xd} tick={tick} stroke={AXIS} label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: '#8b9bb0', fontSize: 11 }} />
        <YAxis dataKey="y" type="number" domain={yDomain ?? ['auto', 'auto']} tick={tick} stroke={AXIS} width={48} label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 18, fill: '#8b9bb0', fontSize: 11 }} />
        <ZAxis range={[40, 40]} />
        {xIsLateral && <ReferenceLine x={0} stroke="#8b9bb0" />}
        {yZero && <ReferenceLine y={0} stroke="#8b9bb0" />}
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as ShotPoint & { __series?: string }
            const s = series.find((x) => x.id === p.__series)
            return (
              <TipBox
                title={<>{s?.label ?? (s ? prettyClub(s.id) : '')}{p.shot ? ` · shot ${p.shot}` : ''}{p.warm ? ' (warm-up)' : ''}</>}
                rows={[
                  ...(p.date ? [{ label: 'Date', value: fmtDate(p.date) }] : []),
                  { label: xLabel.split(' (')[0], value: `${fmt(p.x, 1, { sign: xIsLateral })} ${xUnit}` },
                  { label: yLabel.split(' (')[0], value: `${fmt(p.y)} ${yUnit}` },
                  ...(p.label ? [{ label: '', value: p.label }] : []),
                ]}
              />
            )
          }}
        />
        {series.map((s) => (
          <Scatter
            key={s.id}
            name={s.label ?? prettyClub(s.id)}
            data={s.points.map((p) => ({ ...p, __series: s.id }))}
            fill={s.color ?? clubColor(s.id)}
            shape={(props: unknown) => <ShotDot {...(props as { cx?: number; cy?: number; payload?: ShotPoint; fill?: string })} ghost={s.ghost} r={s.r ?? (s.ghost ? 4 : 5.5)} />}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ---------- Shot sequence within a session ----------

export interface SeqPoint { shot: number; y: number | null; warm?: boolean }

export function SequenceChart({ points, color, unit = 'yds', height = 150, baseMean, baseSd, decimals = 1, label = 'Carry' }: { points: SeqPoint[]; color: string; unit?: string; height?: number; baseMean?: number | null; baseSd?: number | null; decimals?: number; label?: string }) {
  const data = points.filter((p) => num(p.y))
  if (!data.length) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="shot" tick={tick} stroke={AXIS} />
        <YAxis tick={tick} stroke={AXIS} domain={['auto', 'auto']} width={44} tickFormatter={(v) => fmt(v, 0)} />
        {num(baseMean) && num(baseSd) && <ReferenceArea y1={baseMean - baseSd} y2={baseMean + baseSd} fill="#8b9bb0" fillOpacity={0.1} stroke="none" />}
        {num(baseMean) && <ReferenceLine y={baseMean} stroke="#8b9bb0" strokeDasharray="4 4" label={{ value: 'baseline', fill: '#5d6b7e', fontSize: 10, position: 'insideTopRight' }} />}
        <Tooltip
          cursor={{ stroke: AXIS }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as SeqPoint
            return <TipBox title={`Shot ${p.shot}${p.warm ? ' (warm-up)' : ''}`} rows={[{ label, value: `${fmt(p.y, decimals)} ${unit}` }]} />
          }}
        />
        <Line type="monotone" dataKey="y" stroke={color} strokeWidth={2} isAnimationActive={false} connectNulls
          dot={(props: unknown) => {
            const { cx = 0, cy = 0, payload, key } = props as { cx?: number; cy?: number; payload?: SeqPoint; key?: Key | null }
            const k = key == null ? undefined : String(key)
            return payload?.warm
              ? <circle key={k} cx={cx} cy={cy} r={4} fill="#0b0f14" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />
              : <circle key={k} cx={cx} cy={cy} r={4} fill={color} stroke="#0b0f14" />
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------- Combine score + handicap ----------

export function CombineScoreChart({ rows, height = 260 }: { rows: { date: string; score: number | null; hcp: number | null; blowups: number }[]; height?: number }) {
  const data = rows.map((r) => ({ ...r, t: new Date(r.date + 'T00:00:00').getTime() }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(v) => fmtDate(new Date(v).toISOString().slice(0, 10), 'month')} tick={tick} stroke={AXIS} minTickGap={40} />
        <YAxis yAxisId="score" tick={tick} stroke={AXIS} domain={[40, 100]} width={44} />
        <YAxis yAxisId="hcp" orientation="right" reversed tick={tick} stroke={AXIS} domain={[0, 20]} width={40} />
        <Tooltip
          cursor={{ stroke: AXIS }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as (typeof data)[number]
            return <TipBox title={fmtDate(r.date)} rows={[{ label: 'Score', value: fmt(r.score), color: '#f26a1b' }, { label: 'Est. handicap', value: fmt(r.hcp), color: '#38bdf8' }, { label: 'Blow-ups (<30)', value: String(r.blowups) }]} />
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8b9bb0' }} />
        <Line yAxisId="score" name="Combine score" type="monotone" dataKey="score" stroke="#f26a1b" strokeWidth={2.5} dot={{ r: 4, fill: '#f26a1b', strokeWidth: 0 }} isAnimationActive={false} />
        <Line yAxisId="hcp" name="Est. handicap (right, inverted)" type="monotone" dataKey="hcp" stroke="#38bdf8" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Continuous colour for Combine scores 0..100 (red -> amber -> green). */
export function scoreColor(v: number | null | undefined): string {
  if (!num(v)) return 'transparent'
  // 30 and below = red (blow-up), ~55 = amber, 80+ = green
  const x = Math.max(0, Math.min(1, (v - 25) / 60))
  const h = 6 + x * 124
  return `hsl(${h} 72% ${44 + x * 8}%)`
}
