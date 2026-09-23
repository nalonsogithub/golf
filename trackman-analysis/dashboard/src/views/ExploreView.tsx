import { useMemo, useState } from 'react'
import { ALL_CLUBS, COMBINES, SESSIONS } from '../lib/data'
import { useWarmup } from '../lib/app-state'
import { blowupCount, combineShots, excellentCount, goodMean } from '../lib/changes'
import { clubColor, clubRank, prettyClub, shortClub, sortClubs } from '../lib/clubs'
import { METRICS, METRIC_ORDER, clubSessions, fmt, fmtDate, num, pearson, ts, values, type ClubSession } from '../lib/stats'
import { Card, Chip, ClubChip, Segmented } from '../components/ui'
import { ChartTitle, CombineScoreChart, DispersionChart, TrendChart, scoreColor, type ScatterSeries } from '../components/charts'

type Tab = 'trends' | 'dispersion' | 'delivery' | 'combine' | 'sessions'
const TABS: { id: Tab; label: string }[] = [
  { id: 'trends', label: 'Trends' },
  { id: 'dispersion', label: 'Dispersion' },
  { id: 'delivery', label: 'Path & face' },
  { id: 'combine', label: 'Combine' },
  { id: 'sessions', label: 'All sessions' },
]

export default function ExploreView({ param, navigate, openDay }: { param?: string; navigate: (tab: string) => void; openDay: (date: string) => void }) {
  const tab = (TABS.find((t) => t.id === param)?.id ?? 'trends') as Tab
  const { mode, n } = useWarmup()
  const rows = useMemo(() => clubSessions(SESSIONS, mode, n), [mode, n])
  return (
    <div className="stack">
      <Segmented options={TABS} value={tab} onChange={(t) => navigate(t)} />
      {tab === 'trends' && <Trends rows={rows} />}
      {tab === 'dispersion' && <Dispersion rows={rows} />}
      {tab === 'delivery' && <Delivery rows={rows} />}
      {tab === 'combine' && <CombineTab />}
      {tab === 'sessions' && <Sessions rows={rows} openDay={openDay} />}
    </div>
  )
}

function useClubPicker(rows: ClubSession[], defaults: string[]) {
  const clubs = useMemo(() => sortClubs(Array.from(new Set(rows.map((r) => r.block.club))).map((c) => ({ club: c }))).map((x) => x.club), [rows])
  const [sel, setSel] = useState<string[]>(() => defaults.filter((c) => ALL_CLUBS.includes(c)))
  const toggle = (c: string) => setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
  const picker = (
    <div className="seg">
      {clubs.map((c) => (
        <button key={c} className={sel.includes(c) ? 'on' : ''} onClick={() => toggle(c)}>
          <span className="dot" style={{ background: clubColor(c), opacity: sel.includes(c) ? 1 : 0.35 }} />
          {shortClub(c)}
        </button>
      ))}
    </div>
  )
  return { sel, picker, clubs }
}

// ---------------------------------------------------------------- Trends

function Trends({ rows }: { rows: ClubSession[] }) {
  const { sel, picker } = useClubPicker(rows, ['5Iron', '7Iron', '8Iron', 'Driver'])
  const [metric, setMetric] = useState('carry')
  const [stat, setStat] = useState<'mean' | 'sd'>('mean')
  const def = METRICS[metric]
  const available = METRIC_ORDER.filter((k) => rows.some((r) => values(r.shots, k).length))
  const series = sel.map((c) => ({
    id: c,
    points: rows.filter((r) => r.block.club === c && values(r.shots, metric).length >= 3).map((r) => ({ t: ts(r.session.date), date: r.session.date, y: stat === 'mean' ? r.summary.mean[metric] : r.summary.sd[metric], n: r.shots.length })),
  }))

  // first three vs last three sessions per club
  const table = sel.map((c) => {
    const rs = rows.filter((r) => r.block.club === c && values(r.shots, metric).length >= 3)
    const pick = (xs: ClubSession[]) => {
      const v = xs.map((r) => (stat === 'mean' ? r.summary.mean[metric] : r.summary.sd[metric])).filter(num)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    const dates = rs.map((r) => ts(r.session.date))
    const ys = rs.map((r) => (stat === 'mean' ? r.summary.mean[metric] : r.summary.sd[metric]))
    const ok = ys.map((y, i) => [dates[i], y] as const).filter((p) => num(p[1]))
    return { club: c, sessions: rs.length, first: pick(rs.slice(0, 3)), last: pick(rs.slice(-3)), r: pearson(ok.map((p) => p[0]), ok.map((p) => p[1] as number)) }
  })

  return (
    <>
      <div className="row">
        {picker}
        <select className="select" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {available.map((k) => <option key={k} value={k}>{METRICS[k].label}</option>)}
        </select>
        <Segmented options={[{ id: 'mean', label: 'Session mean' }, { id: 'sd', label: 'Session SD (spread)' }]} value={stat} onChange={setStat} />
      </div>
      <Card>
        <ChartTitle title={`${def.label} · ${stat === 'mean' ? 'mean' : 'standard deviation'} per session`} sub="Sessions with at least 3 scored shots. Hover for shot counts." />
        <TrendChart series={series} unit={def.unit} decimals={def.decimals} height={340} refY={stat === 'mean' && def.better === 'zero' ? 0 : undefined} />
      </Card>
      <Card>
        <ChartTitle title="First three sessions versus last three" sub="r = correlation of the per-session value with date; negative means it has been falling" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Club</th><th>Sessions</th><th>First 3</th><th>Last 3</th><th>Change</th><th>r vs time</th></tr></thead>
            <tbody>
              {table.map((t) => (
                <tr key={t.club}>
                  <td><ClubChip club={t.club} /></td>
                  <td>{t.sessions}</td>
                  <td>{fmt(t.first, def.decimals)}</td>
                  <td>{fmt(t.last, def.decimals)}</td>
                  <td>{num(t.first) && num(t.last) ? fmt(t.last - t.first, def.decimals, { sign: true }) : '–'}</td>
                  <td>{fmt(t.r, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- Dispersion

function sessionShade(i: number, total: number, base: string): string {
  // oldest sessions are dim grey, the newest is the full club colour
  const t = total <= 1 ? 1 : i / (total - 1)
  return mix('#3b4452', base, t * t)
}
function mix(a: string, b: string, t: number): string {
  const pa = a.match(/\w\w/g)!.map((x) => parseInt(x, 16))
  const pb = b.match(/\w\w/g)!.map((x) => parseInt(x, 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function Dispersion({ rows }: { rows: ClubSession[] }) {
  const clubs = sortClubs(Array.from(new Set(rows.map((r) => r.block.club))).map((c) => ({ club: c }))).map((x) => x.club)
  const [club, setClub] = useState<string>(clubs.includes('8Iron') ? '8Iron' : clubs[0])
  const [scope, setScope] = useState<'club' | 'all'>('club')
  const lat = (r: ClubSession) => r.summary.lateralKey

  let series: ScatterSeries[] = []
  if (scope === 'all') {
    series = clubs.map((c) => ({
      id: c,
      points: rows.filter((r) => r.block.club === c).flatMap((r) => r.shots.filter((s) => lat(r) && num(s[lat(r)!]) && num(s.carry)).map((s) => ({ x: s[lat(r)!] as number, y: s.carry as number, shot: s.shot, date: r.session.date }))),
    }))
  } else {
    const rs = rows.filter((r) => r.block.club === club && lat(r))
    series = rs.map((r, i) => ({
      id: r.session.id,
      label: `${prettyClub(club)} · ${fmtDate(r.session.date)}`,
      color: sessionShade(i, rs.length, clubColor(club)),
      r: 4 + 3 * (rs.length <= 1 ? 1 : i / (rs.length - 1)),
      points: r.shots.filter((s) => num(s[lat(r)!]) && num(s.carry)).map((s) => ({ x: s[lat(r)!] as number, y: s.carry as number, shot: s.shot, date: r.session.date })),
    }))
  }
  const allPts = series.flatMap((s) => s.points)
  const xs = allPts.map((p) => p.x)
  const sdv = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - xs.reduce((p, q) => p + q, 0) / xs.length) ** 2, 0) / (xs.length - 1)) : null
  const big = xs.length ? (100 * xs.filter((x) => Math.abs(x) > 15).length) / xs.length : null
  const left = xs.length ? (100 * xs.filter((x) => x < 0).length) / xs.length : null

  return (
    <>
      <div className="row">
        <Segmented options={[{ id: 'club', label: 'One club, coloured by session' }, { id: 'all', label: 'All clubs' }]} value={scope} onChange={setScope} />
        {scope === 'club' && (
          <select className="select" value={club} onChange={(e) => setClub(e.target.value)}>
            {clubs.map((c) => <option key={c} value={c}>{prettyClub(c)}</option>)}
          </select>
        )}
        <Chip kind="neutral">{xs.length} shots</Chip>
        <Chip kind="neutral">lateral SD {fmt(sdv)} yds</Chip>
        <Chip kind={num(big) && big > 33 ? 'bad' : 'neutral'}>{fmt(big, 0)} % beyond 15 yds</Chip>
        <Chip kind="neutral">{fmt(left, 0)} % left</Chip>
      </div>
      <Card>
        <ChartTitle title={scope === 'all' ? 'Every scored shot, all clubs' : `${prettyClub(club)}: every scored shot`} sub={scope === 'club' ? 'Grey = oldest sessions, full colour = newest. Green band = within 15 yds of the line.' : 'Uses side where the export has it, otherwise curve.'} />
        <DispersionChart series={series} height={520} />
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- Delivery (path & face)

function Delivery({ rows }: { rows: ClubSession[] }) {
  const withFace = rows.filter((r) => values(r.shots, 'club_path').length && (values(r.shots, 'face_angle').length || values(r.shots, 'face_to_path').length))
  const { sel, picker } = useClubPicker(withFace, ['5Iron', '7Iron', '8Iron', 'Driver'])
  const [yKey, setYKey] = useState<'face_angle' | 'face_to_path'>('face_to_path')
  const series: ScatterSeries[] = sel.map((c) => ({
    id: c,
    points: withFace.filter((r) => r.block.club === c).flatMap((r) => r.shots.filter((s) => num(s.club_path) && num(s[yKey])).map((s) => ({ x: s.club_path as number, y: s[yKey] as number, shot: s.shot, date: r.session.date, label: num(s.curve) ? `curve ${fmt(s.curve, 1, { sign: true })} yds` : num(s.side) ? `side ${fmt(s.side, 1, { sign: true })} yds` : undefined }))),
  }))
  const dates = Array.from(new Set(withFace.map((r) => r.session.date))).sort()
  const attack = sel.map((c) => ({ id: c, points: rows.filter((r) => r.block.club === c && values(r.shots, 'attack_angle').length >= 3).map((r) => ({ t: ts(r.session.date), date: r.session.date, y: r.summary.mean.attack_angle, n: r.shots.length })) }))
  return (
    <>
      <div className="row">
        {picker}
        <Segmented options={[{ id: 'face_to_path', label: 'Face to path' }, { id: 'face_angle', label: 'Face angle' }]} value={yKey} onChange={setYKey} />
        <span className="small muted">Path and face columns exist in {dates.length} sessions ({dates.length ? `${fmtDate(dates[0])} to ${fmtDate(dates.at(-1)!)}` : 'none'}). Later exports dropped them.</span>
      </div>
      <Card>
        <ChartTitle title={`Club path versus ${METRICS[yKey].label.toLowerCase()}`} sub="Top-right = in-to-out with an open face (push / push-fade); bottom-left = out-to-in with a closed face (pull / pull-hook). Hover shows the resulting curve." />
        <DispersionChart series={series} xLabel="Club path (°, +in-to-out)" yLabel={`${METRICS[yKey].label} (°, +open)`} xUnit="°" yUnit="°" height={420} band={null} xIsLateral yZero />
      </Card>
      <Card>
        <ChartTitle title="Attack angle per session" sub="Mean of scored shots. Negative = hitting down." />
        <TrendChart series={attack} unit="°" height={260} refY={0} />
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- Combine

function CombineTab() {
  const [selId, setSelId] = useState(COMBINES.at(-1)?.id ?? '')
  const sel = COMBINES.find((c) => c.id === selId) ?? COMBINES.at(-1)
  const targets = Array.from(new Set(COMBINES.flatMap((c) => c.targets.map((t) => String(t.target))))).sort((a, b) => (a === 'Drive' ? 1 : b === 'Drive' ? -1 : Number(a) - Number(b)))
  const rows = COMBINES.map((c) => ({ date: c.date, score: c.score, hcp: c.estimated_handicap, blowups: blowupCount(c) }))
  if (!COMBINES.length) return <div className="empty">No Combine reports yet.</div>
  return (
    <>
      <div className="grid two">
        <Card>
          <ChartTitle title="Score and estimated handicap" />
          <CombineScoreChart rows={rows} height={260} />
        </Card>
        <Card>
          <ChartTitle title="What decides the score" sub="Blow-ups are shots scored below 30; the mean of the rest barely moves" />
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Score</th><th>Hcp</th><th>Blow-ups</th><th>≥ 80</th><th>Mean of good</th><th>Median</th></tr></thead>
              <tbody>
                {COMBINES.map((c) => {
                  const sc = combineShots(c).map((s) => s.score).filter(num).sort((a, b) => a - b)
                  const med = sc.length ? (sc.length % 2 ? sc[(sc.length - 1) / 2] : (sc[sc.length / 2 - 1] + sc[sc.length / 2]) / 2) : null
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer', outline: c.id === sel?.id ? '1px solid var(--accent)' : undefined }} onClick={() => setSelId(c.id)}>
                      <td>{fmtDate(c.date)}</td><td>{fmt(c.score)}</td><td>{fmt(c.estimated_handicap)}</td><td>{blowupCount(c)}</td><td>{excellentCount(c)}</td><td>{fmt(goodMean(c))}</td><td>{fmt(med, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card>
        <ChartTitle title="Score by target across every Combine" sub="Rows are Combines, newest at the bottom. Colour is the target's score out of 100." />
        <div className="table-wrap">
          <table className="data heat">
            <thead><tr><th>Date</th>{targets.map((t) => <th key={t} style={{ textAlign: 'center' }}>{t === 'Drive' ? 'Drive' : `${t} yds`}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {COMBINES.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDate(c.date)}</td>
                  {targets.map((t) => {
                    const tg = c.targets.find((x) => String(x.target) === t)
                    return <td key={t} className={`cell${tg ? '' : ' empty'}`} style={{ background: scoreColor(tg?.target_score) }}>{tg ? fmt(tg.target_score, 0) : '–'}</td>
                  })}
                  <td><b>{fmt(c.score)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {sel && (
        <Card>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <ChartTitle title={`Shot detail · ${fmtDate(sel.date)}`} sub={`Score ${fmt(sel.score)} · est. handicap ${fmt(sel.estimated_handicap)}`} />
            <select className="select" value={sel.id} onChange={(e) => setSelId(e.target.value)}>
              {COMBINES.map((c) => <option key={c.id} value={c.id}>{fmtDate(c.date)} · {fmt(c.score)}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table className="data heat">
              <thead><tr><th>Target</th><th>Shot</th><th>Score</th><th>Carry</th><th>Total</th><th>Side (ft)</th><th>From pin (ft)</th><th>Ball spd</th><th>Club spd</th><th>Spin</th><th>Attack</th></tr></thead>
              <tbody>
                {sel.targets.flatMap((t) => t.shots.map((s) => (
                  <tr key={`${t.target}-${s.shot}`} className={num(s.score) && s.score < 30 ? 'blowup' : ''}>
                    <td>{t.target === 'Drive' ? 'Drive' : `${t.target} yds`}</td><td>{s.shot}</td>
                    <td className="cell" style={{ background: scoreColor(s.score) }}>{fmt(s.score, 0)}</td>
                    <td>{fmt(s.carry)}</td><td>{fmt(s.total)}</td><td>{fmt(s.side, 1, { sign: true })}</td><td>{fmt(s.from_pin, 0)}</td>
                    <td>{fmt(s.ball_speed)}</td><td>{fmt(s.club_speed)}</td><td>{fmt(s.spin_rate, 0)}</td><td>{fmt(s.attack_angle, 1, { sign: true })}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

// ---------------------------------------------------------------- All sessions

function Sessions({ rows, openDay }: { rows: ClubSession[]; openDay: (date: string) => void }) {
  const [sortKey, setSortKey] = useState<'date' | 'club'>('date')
  const sorted = [...rows].sort((a, b) => (sortKey === 'date' ? b.session.date.localeCompare(a.session.date) || clubRank(a.block.club) - clubRank(b.block.club) : clubRank(a.block.club) - clubRank(b.block.club) || b.session.date.localeCompare(a.session.date)))
  const lat = (r: ClubSession, f: 'mean' | 'sd') => (r.summary.lateralKey ? r.summary[f][r.summary.lateralKey] : null)
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <ChartTitle title="Every session and club" sub="Warm-ups excluded per the top-bar rule. Click a row to open that day in What changed." />
        <Segmented options={[{ id: 'date', label: 'Newest first' }, { id: 'club', label: 'By club' }]} value={sortKey} onChange={setSortKey} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 720 }}>
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Club</th><th>Shots</th><th>Carry</th><th>Carry SD</th><th>Lateral</th><th>Lat. SD</th><th>&gt;15 yds</th><th>Ball spd</th><th>Club spd</th><th>Smash</th><th>Attack</th><th>Face</th><th>Path</th><th>Spin</th></tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.session.id + r.block.club} style={{ cursor: 'pointer' }} onClick={() => openDay(r.session.date)}>
                <td>{fmtDate(r.session.date)}</td>
                <td><ClubChip club={r.block.club} /></td>
                <td>{r.shots.length}{r.raw.length !== r.shots.length && <span className="dim"> +{r.raw.length - r.shots.length} wu</span>}</td>
                <td>{fmt(r.summary.mean.carry)}</td>
                <td>{fmt(r.summary.sd.carry)}</td>
                <td>{fmt(lat(r, 'mean'), 1, { sign: true })}{r.summary.lateralKey === 'curve' && <span className="dim"> c</span>}</td>
                <td>{fmt(lat(r, 'sd'))}</td>
                <td>{fmt(r.summary.pctBig, 0)}{num(r.summary.pctBig) ? ' %' : ''}</td>
                <td>{fmt(r.summary.mean.ball_speed)}</td>
                <td>{fmt(r.summary.mean.club_speed)}</td>
                <td>{fmt(r.summary.mean.smash, 2)}</td>
                <td>{fmt(r.summary.mean.attack_angle, 1, { sign: true })}</td>
                <td>{fmt(r.summary.mean.face_angle, 1, { sign: true })}</td>
                <td>{fmt(r.summary.mean.club_path, 1, { sign: true })}</td>
                <td>{fmt(r.summary.mean.spin_rate, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">"c" marks sessions whose export had curve instead of side (pre-August 2025); the two are not directly comparable.</div>
    </Card>
  )
}
