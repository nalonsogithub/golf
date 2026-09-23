import { useMemo } from 'react'
import { COMBINES, DAYS, DATA, SESSIONS, latestDay, type DayEntry } from '../lib/data'
import { useWarmup } from '../lib/app-state'
import { BASELINE_SESSIONS, computeClubChanges, computeCombineChange, type ClubChange, type CombineChange, type MetricChange } from '../lib/changes'
import { clubColor, prettyClub, shortClub } from '../lib/clubs'
import { daysBetween, fmt, fmtDate, num } from '../lib/stats'
import { Card, Chip, ClubChip, Delta, Empty, Kpi } from '../components/ui'
import { ChartTitle, DispersionChart, SequenceChart, scoreColor, type ScatterSeries } from '../components/charts'

const SHOW_METRICS = ['carry', 'side', 'curve', 'ball_speed', 'club_speed', 'smash', 'attack_angle', 'face_angle', 'club_path', 'face_to_path', 'launch_angle', 'spin_rate', 'total']

export default function DailyView({ param, navigate }: { param?: string; navigate: (date: string) => void }) {
  const day: DayEntry = DAYS.find((d) => d.date === param) ?? latestDay()
  const idx = DAYS.indexOf(day)
  const newer = idx > 0 ? DAYS[idx - 1] : null
  const older = idx < DAYS.length - 1 ? DAYS[idx + 1] : null
  const { mode, n } = useWarmup()

  const clubChanges = useMemo(() => (day.session ? computeClubChanges(day.session, SESSIONS, mode, n) : []), [day, mode, n])
  const combineChange = useMemo(() => (day.combine ? computeCombineChange(day.combine, COMBINES) : null), [day])

  const prevSession = SESSIONS.filter((s) => s.date < day.date).at(-1)
  const rawShots = day.session?.clubs.reduce((a, c) => a + c.shots.length, 0) ?? 0
  const scored = clubChanges.reduce((a, c) => a + c.today.shots.length, 0)
  const chrono = [...DAYS].reverse()

  return (
    <div className="stack">
      <div className="day-hero">
        <Card>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="eyebrow">What changed</div>
            <div className="day-nav">
              <button disabled={!older} onClick={() => older && navigate(older.date)} title="Older">‹</button>
              <select className="select" value={day.date} onChange={(e) => navigate(e.target.value)}>
                {DAYS.map((d) => (
                  <option key={d.date} value={d.date}>
                    {fmtDate(d.date)} · {d.session && d.combine ? 'session + Combine' : d.combine ? 'Combine' : 'session'}
                    {d.date > DATA.generated ? ' (future date?)' : ''}
                  </option>
                ))}
              </select>
              <button disabled={!newer} onClick={() => newer && navigate(newer.date)} title="Newer">›</button>
            </div>
          </div>
          <div className="date">
            {fmtDate(day.date, 'long')}
            {prevSession && day.session && (() => { const d = daysBetween(prevSession.date, day.date); return <span className="ago">{d} day{d === 1 ? '' : 's'} since the previous session</span> })()}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {day.session && <Chip kind="info">Range session</Chip>}
            {day.combine && <Chip kind="record">Combine</Chip>}
            {day.session?.clubs.map((c) => <ClubChip key={c.club} club={c.club} />)}
          </div>
          {day.session?.note && <div className="note">{day.session.note}</div>}
          {day.session && (
            <div className="hint">
              Warm-up rule for this session: {day.session.warmup_rule ?? 'first 4 shots of the loftiest club'}.
              {mode === 'tagged' ? ' Warm-ups are excluded from every comparison below.' : mode === 'none' ? ' Warm-up exclusion is switched off in the top bar.' : ` The top bar overrides this to "first ${n} shots of every club".`}
            </div>
          )}
          <div className="timeline" title="Every day in the data set. Blue = Combine.">
            {chrono.map((d) => {
              const h = d.session ? 12 + Math.min(32, d.session.clubs.reduce((a, c) => a + c.shots.length, 0) * 0.6) : 18
              return <div key={d.date} className={`tick${d.combine && !d.session ? ' combine' : ''}${d.date === day.date ? ' sel' : ''}`} style={{ height: h }} title={fmtDate(d.date)} onClick={() => navigate(d.date)} />
            })}
          </div>
        </Card>
        <div className="grid kpis" style={{ alignContent: 'start' }}>
          {day.session && <Kpi label="Shots hit" value={rawShots} decimals={0} foot={<span>{scored} scored after warm-ups</span>} />}
          {day.session && <Kpi label="Clubs" value={day.session.clubs.length} decimals={0} foot={<span>{day.session.clubs.map((c) => shortClub(c.club)).join(' · ')}</span>} />}
          {combineChange && (
            <Kpi label="Combine score" value={combineChange.score} foot={<><span>prev {fmt(combineChange.prevScore)}</span><Delta value={num(combineChange.score) && num(combineChange.prevScore) ? combineChange.score - combineChange.prevScore : null} verdict={num(combineChange.score) && num(combineChange.prevScore) ? (combineChange.score > combineChange.prevScore ? 'good' : combineChange.score < combineChange.prevScore ? 'bad' : 'neutral') : 'none'} /></>} />
          )}
          {combineChange && (
            <Kpi label="Est. handicap" value={combineChange.hcp} foot={<><span>prev {fmt(combineChange.prevHcp)}</span><Delta value={num(combineChange.hcp) && num(combineChange.prevHcp) ? combineChange.hcp - combineChange.prevHcp : null} verdict={num(combineChange.hcp) && num(combineChange.prevHcp) ? (combineChange.hcp < combineChange.prevHcp ? 'good' : combineChange.hcp > combineChange.prevHcp ? 'bad' : 'neutral') : 'none'} /></>} />
          )}
          {!combineChange && clubChanges.length > 0 && <SessionVerdictKpi changes={clubChanges} />}
        </div>
      </div>

      {combineChange && <CombineCard c={combineChange} />}

      {clubChanges.map((c) => <ClubCard key={c.club} c={c} />)}

      {!day.session && !day.combine && <Empty>No data on this day.</Empty>}

      <div className="hint">
        Baseline = every scored shot from the previous {BASELINE_SESSIONS} sessions with the same club (sessions with fewer than 3 scored shots are skipped). Records are judged against every earlier session of that club with at least 3 scored shots. Deltas are coloured only when they clear a noise threshold (for example 3 yds of carry, 1° of face or path, 20 % of spread).
      </div>
    </div>
  )
}

function SessionVerdictKpi({ changes }: { changes: ClubChange[] }) {
  const scored = changes.filter((c) => c.prior.length && c.today.shots.length >= 3)
  const s = scored.length ? scored.reduce((a, c) => a + c.score, 0) / scored.length : 0
  const label = s >= 0.5 ? 'Better' : s >= 0.15 ? 'Slightly better' : s <= -0.5 ? 'Worse' : s <= -0.15 ? 'Slightly worse' : 'In line'
  const good = changes.filter((c) => c.score >= 0.2).length
  const bad = changes.filter((c) => c.score <= -0.2).length
  return (
    <Kpi
      label="Versus baseline"
      value={label}
      foot={<><span>{good} club{good === 1 ? '' : 's'} up · {bad} down</span><span className="dim">{changes.length - scored.length ? `${changes.length - scored.length} no baseline` : ''}</span></>}
    />
  )
}

// ---------------------------------------------------------------- club card

function ClubCard({ c }: { c: ClubChange }) {
  const col = clubColor(c.club)
  const accent = c.score >= 0.2 ? 'good' : c.score <= -0.2 ? 'bad' : 'neutral'
  const lat = c.lateralKey
  const shown = SHOW_METRICS.map((k) => c.metrics.find((m) => m.def.key === k)).filter((m): m is MetricChange => !!m)
  const records = c.metrics.flatMap((m) => [
    ...(m.spreadRecord ? [`Tightest ${m.def.short.toLowerCase()} spread on record`] : []),
    ...(m.record === 'best' ? [m.def.better === 'zero' ? `Straightest ${m.def.short.toLowerCase()} on record` : `Best ${m.def.short.toLowerCase()} on record`] : []),
  ])

  const todayPts = c.today.raw
    .filter((s) => lat && num(s[lat]) && num(s.carry))
    .map((s) => ({ x: s[lat!] as number, y: s.carry as number, shot: s.shot, warm: !c.today.shots.includes(s) }))
  const ghostPts = c.prior.flatMap((r) => r.shots.filter((s) => lat && num(s[lat]) && num(s.carry)).map((s) => ({ x: s[lat!] as number, y: s.carry as number, shot: s.shot, date: r.session.date })))
  const series: ScatterSeries[] = [
    ...(ghostPts.length ? [{ id: 'base', label: `Baseline (${c.prior.length} sessions)`, color: '#8b9bb0', points: ghostPts, ghost: true }] : []),
    { id: c.club, label: `${prettyClub(c.club)} today`, color: col, points: todayPts },
  ]
  const carry = c.metrics.find((m) => m.def.key === 'carry')

  return (
    <Card className="club-card" accent={accent}>
      <div className="head">
        <div className="swatch" style={{ background: col }} />
        <div>
          <h3>{prettyClub(c.club)}</h3>
          <div className="headline">{c.headline}</div>
        </div>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <Chip kind="neutral">{c.today.shots.length} scored{c.warmupsExcluded ? ` · ${c.warmupsExcluded} warm-up${c.warmupsExcluded === 1 ? '' : 's'}` : ''}</Chip>
          {c.prior.length > 0 && <Chip kind="info" title={c.prior.map((r) => fmtDate(r.session.date)).join(', ')}>vs {c.prior.length} prior session{c.prior.length === 1 ? '' : 's'}</Chip>}
          {records.map((r) => <Chip key={r} kind="record">★ {r}</Chip>)}
        </div>
      </div>
      <div className="body">
        <div className="metrics">
          <div className="mgrid">
            {shown.map((m) => <MetricTile key={m.def.key} m={m} />)}
            {num(c.pctBig.today) && (
              <div className="metric">
                <div className="l"><span>&gt;15 yds off</span></div>
                <div className="v">{fmt(c.pctBig.today, 0)}<span className="u">%</span></div>
                <div className="b"><span>base {fmt(c.pctBig.base, 0)} %</span>{num(c.pctBig.base) && <Delta value={c.pctBig.today - c.pctBig.base} decimals={0} pct verdict={Math.abs(c.pctBig.today - c.pctBig.base) < 10 ? 'neutral' : c.pctBig.today < c.pctBig.base ? 'good' : 'bad'} />}</div>
                <div className="sdrow"><span>finished left</span><span>{fmt(c.pctLeft.today, 0)} % <span className="dim">/ {fmt(c.pctLeft.base, 0)} %</span></span></div>
              </div>
            )}
          </div>
          {c.prior.length > 0 && c.today.shots.length >= 3 && (
            <div className="verdict-bar" title={`Overall impression ${fmt(c.score, 2, { sign: true })} (−1 worse … +1 better)`}>
              <div className="pin" style={{ left: `${50 + c.score * 50}%` }} />
            </div>
          )}
          <ul className="bullets" style={{ marginTop: 12 }}>
            {c.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
        <div className="viz">
          {lat ? (
            <div>
              <ChartTitle title="Where the ball finished" sub={`Today's shots over the baseline cloud · shaded = within 15 yds · dashed hollow = warm-up`} />
              <DispersionChart series={series} height={280} xLabel={`${lat === 'side' ? 'Side' : 'Curve'} (yds, +R / −L)`} />
            </div>
          ) : (
            <div className="hint">This export has no side or curve column, so there is no dispersion picture for this club.</div>
          )}
          {carry && (
            <div>
              <ChartTitle title="Carry shot by shot" sub="Dashed line and band = baseline mean ± 1 SD" />
              <SequenceChart points={c.today.raw.map((s) => ({ shot: s.shot, y: (s.carry as number) ?? null, warm: !c.today.shots.includes(s) }))} color={col} baseMean={carry.base} baseSd={carry.baseSd} height={150} />
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function MetricTile({ m }: { m: MetricChange }) {
  const d = m.def
  const zeroish = d.better === 'zero'
  return (
    <div className="metric">
      <div className="l"><span>{d.short}</span>{m.record === 'best' && <span title="Record" style={{ color: '#fcd34d' }}>★</span>}</div>
      <div className="v">
        {fmt(m.today, d.decimals, { sign: zeroish })}<span className="u">{d.unit}</span>
      </div>
      <div className="b">
        <span>base {fmt(m.base, d.decimals, { sign: zeroish })}</span>
        <Delta value={m.delta} decimals={d.decimals} unit={d.unit} verdict={m.verdict} />
      </div>
      {d.spreadMatters && num(m.todaySd) && (
        <div className="sdrow">
          <span>SD {fmt(m.todaySd, d.decimals)}<span className="dim"> / {fmt(m.baseSd, d.decimals)}</span></span>
          {m.spreadVerdict !== 'none' && (
            <span className={`chip ${m.spreadVerdict}`} style={{ padding: '0 6px' }}>
              {m.spreadRecord ? '★ ' : ''}{m.spreadVerdict === 'good' ? 'tighter' : m.spreadVerdict === 'bad' ? 'wider' : 'same'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- combine card

function CombineCard({ c }: { c: CombineChange }) {
  const accent = num(c.score) && num(c.prevScore) ? (c.score > c.prevScore + 1 ? 'good' : c.score < c.prevScore - 1 ? 'bad' : 'neutral') : 'neutral'
  const tile = (label: string, today: number | null, prev: number | null, betterLower: boolean, decimals = 0) => {
    const delta = num(today) && num(prev) ? today - prev : null
    const verdict = !num(delta) ? 'none' : Math.abs(delta) < 0.5 ? 'neutral' : (delta < 0) === betterLower ? 'good' : 'bad'
    return (
      <div className="metric">
        <div className="l"><span>{label}</span></div>
        <div className="v">{fmt(today, decimals)}</div>
        <div className="b"><span>prev {fmt(prev, decimals)}</span><Delta value={delta} decimals={decimals} verdict={verdict} /></div>
      </div>
    )
  }
  return (
    <Card className="club-card" accent={accent}>
      <div className="head">
        <div className="swatch" style={{ background: '#38bdf8' }} />
        <div>
          <h3>Trackman Combine{c.best ? ' · best score in the data set' : ''}</h3>
          <div className="headline">{c.shots} scored shots across {c.today.targets.length} targets{c.prev ? ` · compared with the ${fmtDate(c.prev.date)} Combine` : ''}</div>
        </div>
        {c.best && <Chip kind="record">★ Personal best</Chip>}
      </div>
      <div className="body">
        <div className="metrics">
          <div className="mgrid">
            {tile('Score', c.score, c.prevScore, false, 1)}
            {tile('Est. handicap', c.hcp, c.prevHcp, true, 1)}
            {tile('Blow-ups (<30)', c.blowups, c.prevBlowups, true)}
            {tile('Shots ≥ 80', c.excellent, c.prevExcellent, false)}
            {tile('Mean of good shots', c.goodMean, c.prevGoodMean, false, 1)}
          </div>
          <ul className="bullets" style={{ marginTop: 12 }}>
            {c.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
        <div className="viz">
          <ChartTitle title="Score by target" sub="Colour = today's score; arrow = change from the previous Combine" />
          <div className="table-wrap" style={{ maxHeight: 'none' }}>
            <table className="data heat">
              <thead>
                <tr><th>Target</th><th>Score</th><th>Δ prev</th><th>From pin</th><th>Carry vs target</th></tr>
              </thead>
              <tbody>
                {c.targets.map((t) => (
                  <tr key={t.target}>
                    <td>{t.target}</td>
                    <td className="cell" style={{ background: scoreColor(t.score) }}>{fmt(t.score, 0)}</td>
                    <td>{num(t.delta) ? <Delta value={t.delta} decimals={0} verdict={Math.abs(t.delta) < 5 ? 'neutral' : t.delta > 0 ? 'good' : 'bad'} /> : <span className="dim">–</span>}</td>
                    <td>{fmt(t.fromPin, 0)} ft</td>
                    <td>{num(t.carryErr) ? <span style={{ color: Math.abs(t.carryErr) >= 6 ? '#f87171' : undefined }}>{fmt(t.carryErr, 0, { sign: true })} yds</span> : <span className="dim">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  )
}
