import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { COMBINES, REPORT_MD, SESSIONS, shotCount } from '../lib/data'
import { useWarmup } from '../lib/app-state'
import { blowupCount } from '../lib/changes'
import { clubColor, prettyClub } from '../lib/clubs'
import { clubSessions, fmt, fmtDate, num, ts } from '../lib/stats'
import { Card, Delta, Kpi } from '../components/ui'
import { ChartTitle, CombineScoreChart, TrendChart } from '../components/charts'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const text = (n: ReactNode): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' && 'props' in n ? text((n as { props: { children?: ReactNode } }).props.children) : '')

export default function ReportView() {
  const { mode, n } = useWarmup()
  const rows = useMemo(() => clubSessions(SESSIONS, mode, n), [mode, n])

  const latestCombine = COMBINES.at(-1)
  const prevCombine = COMBINES.at(-2)
  const combineRows = COMBINES.map((c) => ({ date: c.date, score: c.score, hcp: c.estimated_handicap, blowups: blowupCount(c) }))

  // headline club: the iron with the most sessions
  const headlineClub = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) if (r.shots.length >= 3 && /Iron/.test(r.block.club)) counts.set(r.block.club, (counts.get(r.block.club) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '7Iron'
  }, [rows])
  const seriesFor = (club: string, pick: (r: (typeof rows)[number]) => number | null) =>
    rows.filter((r) => r.block.club === club && r.shots.length >= 3).map((r) => ({ t: ts(r.session.date), date: r.session.date, y: pick(r), n: r.shots.length }))
  const lateral = (r: (typeof rows)[number]) => (r.summary.lateralKey ? r.summary.sd[r.summary.lateralKey] : null)

  const acc = seriesFor(headlineClub, lateral)
  const accLast = acc.filter((p) => num(p.y)).at(-1)
  const accPrev = acc.filter((p) => num(p.y)).slice(-4, -1)
  const accPrevMean = accPrev.length ? accPrev.reduce((a, p) => a + (p.y as number), 0) / accPrev.length : null

  const drv = seriesFor('Driver', (r) => r.summary.mean.ball_speed)
  const drvLast = drv.filter((p) => num(p.y)).at(-1)
  const carry7 = seriesFor('7Iron', (r) => r.summary.mean.carry)
  const carry7Last = carry7.filter((p) => num(p.y)).at(-1)

  const trendClubs = ['5Iron', '7Iron', '8Iron', 'Driver'].filter((c) => rows.some((r) => r.block.club === c))
  const toc = useMemo(() => REPORT_MD.split('\n').filter((l) => /^##+ /.test(l)).map((l) => ({ level: l.startsWith('### ') ? 3 : 2, title: l.replace(/^#+ /, '').trim() })).map((h) => ({ ...h, id: slug(h.title) })), [])
  const [active, setActive] = useState<string>('')
  useEffect(() => {
    const els = toc.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e)
    if (!els.length) return
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (vis[0]) setActive(vis[0].target.id)
    }, { rootMargin: '-80px 0px -60% 0px' })
    els.forEach((e) => obs.observe(e))
    return () => obs.disconnect()
  }, [toc])

  return (
    <div className="stack">
      <div className="grid kpis">
        <Kpi
          label="Latest Combine"
          value={latestCombine?.score}
          unit={`hcp ${fmt(latestCombine?.estimated_handicap)}`}
          spark={combineRows.map((r) => r.score)}
          foot={<><span>{latestCombine ? fmtDate(latestCombine.date) : ''}</span>{prevCombine && num(latestCombine?.score) && num(prevCombine.score) && <Delta value={latestCombine!.score! - prevCombine.score} verdict={latestCombine!.score! > prevCombine.score ? 'good' : 'bad'} />}</>}
        />
        <Kpi
          label={`${prettyClub(headlineClub)} side SD`}
          value={accLast?.y}
          unit="yds"
          spark={acc.map((p) => p.y)}
          sparkColor={clubColor(headlineClub)}
          foot={<><span>vs prior 3: {fmt(accPrevMean)}</span>{num(accLast?.y) && num(accPrevMean) && <Delta value={accLast!.y! - accPrevMean} verdict={Math.abs(accLast!.y! - accPrevMean) < 1 ? 'neutral' : accLast!.y! < accPrevMean ? 'good' : 'bad'} />}</>}
        />
        <Kpi label="7-iron carry" value={carry7Last?.y} unit="yds" spark={carry7.map((p) => p.y)} sparkColor={clubColor('7Iron')} foot={<span>{carry7Last ? fmtDate(carry7Last.date) : 'no data'}</span>} />
        <Kpi label="Driver ball speed" value={drvLast?.y} unit="mph" spark={drv.map((p) => p.y)} sparkColor={clubColor('Driver')} foot={<span>{drvLast ? fmtDate(drvLast.date) : 'no data'}</span>} />
        <Kpi label="Data set" value={SESSIONS.length} unit="sessions" decimals={0} foot={<span>{shotCount()} shots · {COMBINES.length} Combines · {fmtDate(SESSIONS[0].date, 'month')} to {fmtDate(SESSIONS.at(-1)!.date, 'month')}</span>} />
      </div>

      <div className="grid two">
        <Card>
          <ChartTitle title="Combine score and estimated handicap" sub="The score is a count of blow-ups: fewer disasters, higher score" />
          <CombineScoreChart rows={combineRows} height={240} />
        </Card>
        <Card>
          <ChartTitle title="Lateral spread per session" sub={`SD of side (or curve) in yards, warm-ups ${mode === 'none' ? 'included' : 'excluded'} · sessions with 3+ scored shots`} />
          <TrendChart series={trendClubs.map((c) => ({ id: c, points: seriesFor(c, lateral) }))} unit="yds" height={240} />
        </Card>
      </div>

      <div className="report-layout">
        <nav className="toc">
          <div className="eyebrow" style={{ padding: '0 10px 6px' }}>Contents</div>
          {toc.map((h) => (
            <a key={h.id} href={'#' + h.id} className={`${h.level === 3 ? 'l3' : ''} ${active === h.id ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
              {h.title}
            </a>
          ))}
        </nav>
        <Card>
          <article className="prose">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => <h2 id={slug(text(children))} style={{ scrollMarginTop: 80 }}>{children}</h2>,
                h3: ({ children }) => <h3 id={slug(text(children))} style={{ scrollMarginTop: 80 }}>{children}</h3>,
                a: ({ href, children }) => <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>,
              }}
            >
              {REPORT_MD}
            </Markdown>
          </article>
        </Card>
      </div>
    </div>
  )
}
