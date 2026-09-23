// "What changed" engine: compares one day's session (and Combine) against the player's own baseline.

import type { Combine, Session } from '../types'
import { prettyClub, sortClubs } from './clubs'
import { METRICS, type MetricDef, type WarmupMode, type ClubSession, clubSessions, fmt, mean, num, values, warmupCount } from './stats'

export const BASELINE_SESSIONS = 5
export const MIN_SHOTS = 3

/** Absolute change in the mean that counts as "moved" */
const MOVE: Record<string, number> = {
  carry: 3, total: 3, side: 3, curve: 3, ball_speed: 1.5, club_speed: 1.5, smash: 0.02,
  attack_angle: 1, club_path: 1, face_angle: 1, face_to_path: 1, launch_angle: 1, dynamic_loft: 1, spin_rate: 300,
}
const SPREAD_MOVE = 0.2 // 20 % relative change in SD

export type Verdict = 'good' | 'bad' | 'neutral' | 'none'

export interface MetricChange {
  def: MetricDef
  today: number | null
  base: number | null
  delta: number | null
  verdict: Verdict
  todaySd: number | null
  baseSd: number | null
  spreadVerdict: Verdict
  record: 'best' | 'worst' | null
  spreadRecord: 'best' | null
}

export interface ClubChange {
  club: string
  today: ClubSession
  prior: ClubSession[]
  allPrior: ClubSession[]
  warmupsExcluded: number
  metrics: MetricChange[]
  lateralKey: 'side' | 'curve' | null
  pctBig: { today: number | null; base: number | null }
  pctLeft: { today: number | null; base: number | null }
  bullets: string[]
  headline: string
  score: number // -1..1 overall impression for the card accent
}

function verdictFor(def: MetricDef, today: number | null, base: number | null): Verdict {
  if (!num(today) || !num(base)) return 'none'
  const d = today - base
  const thr = MOVE[def.key] ?? 0
  if (def.better === 'zero') {
    const dd = Math.abs(today) - Math.abs(base)
    if (Math.abs(dd) < thr) return 'neutral'
    return dd < 0 ? 'good' : 'bad'
  }
  if (Math.abs(d) < thr) return 'neutral'
  if (def.better === 'none') return 'neutral'
  return (d > 0) === (def.better === 'up') ? 'good' : 'bad'
}

function spreadVerdictFor(def: MetricDef, t: number | null, b: number | null): Verdict {
  if (!def.spreadMatters || !num(t) || !num(b) || b === 0) return 'none'
  const rel = (t - b) / b
  if (Math.abs(rel) < SPREAD_MOVE) return 'neutral'
  return rel < 0 ? 'good' : 'bad'
}

const pooled = (rows: ClubSession[], key: string) => rows.flatMap((r) => values(r.shots, key))

function pooledSd(rows: ClubSession[], key: string): number | null {
  const v = pooled(rows, key)
  if (v.length < 2) return null
  const m = mean(v)!
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1))
}

export function computeClubChanges(session: Session, sessions: Session[], mode: WarmupMode, n: number): ClubChange[] {
  const rows = clubSessions(sessions, mode, n)
  const todayRows = rows.filter((r) => r.session.id === session.id)
  const out: ClubChange[] = []

  for (const today of sortClubs(todayRows.map((r) => ({ club: r.block.club, row: r }))).map((x) => x.row)) {
    const club = today.block.club
    const allPrior = rows.filter((r) => r.block.club === club && r.session.date < session.date && r.shots.length >= MIN_SHOTS)
    const prior = allPrior.slice(-BASELINE_SESSIONS)
    const lateralKey = today.summary.lateralKey
    const metrics: MetricChange[] = []

    for (const def of Object.values(METRICS)) {
      const tv = values(today.shots, def.key)
      if (!tv.length) continue
      const bv = pooled(prior, def.key)
      const t = today.summary.mean[def.key]
      const b = bv.length ? mean(bv) : null
      const tSd = today.summary.sd[def.key]
      const bSd = pooledSd(prior, def.key)
      const history = allPrior.filter((r) => values(r.shots, def.key).length >= MIN_SHOTS)
      let record: MetricChange['record'] = null
      let spreadRecord: MetricChange['spreadRecord'] = null
      if (history.length >= 3 && num(t) && today.shots.length >= MIN_SHOTS + 2) {
        const means = history.map((r) => r.summary.mean[def.key]).filter(num)
        if (def.better === 'up' && t > Math.max(...means)) record = 'best'
        if (def.better === 'zero' && Math.abs(t) < Math.min(...means.map(Math.abs))) record = 'best'
        if (def.spreadMatters && num(tSd)) {
          const sds = history.map((r) => r.summary.sd[def.key]).filter(num)
          if (sds.length >= 3 && tSd < Math.min(...sds)) spreadRecord = 'best'
        }
      }
      metrics.push({
        def, today: t, base: b, delta: num(t) && num(b) ? t - b : null,
        verdict: verdictFor(def, t, b), todaySd: tSd, baseSd: bSd,
        spreadVerdict: spreadVerdictFor(def, tSd, bSd), record, spreadRecord,
      })
    }

    const baseLateral = lateralKey ? pooled(prior, lateralKey) : []
    const pctBig = {
      today: today.summary.pctBig,
      base: baseLateral.length ? (100 * baseLateral.filter((x) => Math.abs(x) > 15).length) / baseLateral.length : null,
    }
    const pctLeft = {
      today: today.summary.pctLeft,
      base: baseLateral.length ? (100 * baseLateral.filter((x) => x < 0).length) / baseLateral.length : null,
    }

    const change: ClubChange = {
      club, today, prior, allPrior, warmupsExcluded: warmupCount(today.raw, mode, n), metrics, lateralKey, pctBig, pctLeft,
      bullets: [], headline: '', score: 0,
    }
    narrate(change)
    out.push(change)
  }
  return out
}

const get = (c: ClubChange, key: string) => c.metrics.find((m) => m.def.key === key)

function narrate(c: ClubChange) {
  const name = prettyClub(c.club)
  const b: string[] = []
  let score = 0
  const k = c.prior.length

  if (c.today.shots.length < MIN_SHOTS) {
    c.headline = `Only ${c.today.shots.length} scored shot${c.today.shots.length === 1 ? '' : 's'} after warm-ups; too few to compare.`
    c.bullets = b
    return
  }
  if (!k) {
    c.headline = `First ${name} session in the data set. This becomes the baseline.`
    c.bullets = b
    return
  }

  const lat = c.lateralKey ? get(c, c.lateralKey) : undefined
  if (lat && num(lat.todaySd) && num(lat.baseSd)) {
    const rel = (lat.todaySd - lat.baseSd) / lat.baseSd
    if (lat.spreadRecord === 'best') {
      b.push(`Tightest ${name} session on record: ${c.lateralKey} SD ${fmt(lat.todaySd)} yds against ${fmt(lat.baseSd)} in the previous ${k} sessions and ${fmt(Math.min(...c.allPrior.map((r) => r.summary.sd[c.lateralKey!]).filter(num)))} as the previous best.`)
      score += 1
    } else if (rel < -SPREAD_MOVE) {
      b.push(`Dispersion tightened: ${c.lateralKey} SD ${fmt(lat.todaySd)} yds versus ${fmt(lat.baseSd)} across the prior ${k} sessions (${fmt(100 * rel, 0)} %).`)
      score += 0.6
    } else if (rel > SPREAD_MOVE) {
      b.push(`Dispersion widened: ${c.lateralKey} SD ${fmt(lat.todaySd)} yds versus ${fmt(lat.baseSd)} across the prior ${k} sessions (+${fmt(100 * rel, 0)} %).`)
      score -= 0.6
    } else {
      b.push(`Dispersion unchanged: ${c.lateralKey} SD ${fmt(lat.todaySd)} yds against a ${fmt(lat.baseSd)} baseline.`)
    }
    if (num(lat.today) && num(lat.base)) {
      const side = (v: number) => (v < 0 ? 'left' : 'right')
      if (Math.sign(lat.today) !== Math.sign(lat.base) && Math.abs(lat.today - lat.base) >= MOVE.side) {
        b.push(`The miss flipped: average ${c.lateralKey} ${fmt(lat.today, 1, { sign: true })} yds (${side(lat.today)}) after a ${fmt(lat.base, 1, { sign: true })} (${side(lat.base)}) baseline; ${fmt(c.pctLeft.today, 0)} % of shots finished left versus ${fmt(c.pctLeft.base, 0)} % before.`)
      } else if (lat.verdict === 'good') {
        b.push(`Bias moved toward the target: average ${c.lateralKey} ${fmt(lat.today, 1, { sign: true })} yds versus ${fmt(lat.base, 1, { sign: true })}.`)
        score += 0.3
      } else if (lat.verdict === 'bad') {
        b.push(`Bias grew: average ${c.lateralKey} ${fmt(lat.today, 1, { sign: true })} yds versus ${fmt(lat.base, 1, { sign: true })} (${side(lat.today)} miss).`)
        score -= 0.3
      }
    }
    if (num(c.pctBig.today) && num(c.pctBig.base) && Math.abs(c.pctBig.today - c.pctBig.base) >= 10) {
      b.push(`Shots more than 15 yds off line: ${fmt(c.pctBig.today, 0)} % today versus ${fmt(c.pctBig.base, 0)} % baseline.`)
      score += c.pctBig.today < c.pctBig.base ? 0.3 : -0.3
    }
  }

  const carry = get(c, 'carry')
  if (carry && num(carry.delta) && Math.abs(carry.delta) >= MOVE.carry) {
    const smash = get(c, 'smash')
    const cs = get(c, 'club_speed')
    const bs = get(c, 'ball_speed')
    let why = ''
    if (smash && num(smash.delta) && Math.abs(smash.delta) >= MOVE.smash && cs && num(cs.delta) && Math.abs(cs.delta) < MOVE.club_speed) {
      why = ` The change is strike, not speed: smash ${fmt(smash.today, 2)} versus ${fmt(smash.base, 2)} with club speed flat at ${fmt(cs.today)} mph.`
    } else if (cs && num(cs.delta) && Math.abs(cs.delta) >= MOVE.club_speed) {
      why = ` Club speed moved with it: ${fmt(cs.today)} mph versus ${fmt(cs.base)}.`
    } else if (bs && num(bs.delta) && Math.abs(bs.delta) >= MOVE.ball_speed) {
      why = ` Ball speed moved with it: ${fmt(bs.today)} mph versus ${fmt(bs.base)}.`
    }
    b.push(`Carry ${carry.delta > 0 ? 'up' : 'down'} ${fmt(Math.abs(carry.delta))} yds: ${fmt(carry.today)} against a ${fmt(carry.base)} baseline${carry.record === 'best' ? ', the longest average on record' : ''}.${why}`)
    score += carry.delta > 0 ? 0.3 : -0.2
  }
  if (carry && carry.spreadVerdict !== 'none' && carry.spreadVerdict !== 'neutral') {
    b.push(`Distance control ${carry.spreadVerdict === 'good' ? 'tighter' : 'looser'}: carry SD ${fmt(carry.todaySd)} yds versus ${fmt(carry.baseSd)}.`)
    score += carry.spreadVerdict === 'good' ? 0.3 : -0.3
  }

  const aa = get(c, 'attack_angle')
  if (aa && num(aa.delta) && Math.abs(aa.delta) >= MOVE.attack_angle) {
    b.push(`Attack angle ${aa.delta > 0 ? 'shallower' : 'steeper'}: ${fmt(aa.today, 1, { sign: true })}° versus ${fmt(aa.base, 1, { sign: true })}°.`)
  }
  for (const key of ['face_angle', 'club_path', 'face_to_path'] as const) {
    const m = get(c, key)
    if (m && num(m.delta) && Math.abs(m.delta) >= MOVE[key]) {
      b.push(`${m.def.label} ${fmt(m.today, 1, { sign: true })}° versus ${fmt(m.base, 1, { sign: true })}° (${m.verdict === 'good' ? 'closer to square' : m.verdict === 'bad' ? 'further from square' : 'moved'}).`)
      score += m.verdict === 'good' ? 0.2 : m.verdict === 'bad' ? -0.2 : 0
    }
  }
  const spin = get(c, 'spin_rate')
  if (spin && num(spin.delta) && Math.abs(spin.delta) >= MOVE.spin_rate) {
    b.push(`Spin ${spin.delta > 0 ? 'up' : 'down'} ${fmt(Math.abs(spin.delta), 0)} rpm to ${fmt(spin.today, 0)}.`)
  }

  if (!b.length) b.push(`Nothing moved beyond normal session-to-session noise against the prior ${k} sessions.`)

  c.score = Math.max(-1, Math.min(1, score))
  c.headline = c.score >= 0.6 ? 'A clearly better session than the baseline.'
    : c.score >= 0.2 ? 'Modestly better than the baseline.'
    : c.score <= -0.6 ? 'A clearly worse session than the baseline.'
    : c.score <= -0.2 ? 'Slightly worse than the baseline.'
    : 'In line with the baseline.'
  c.bullets = b
}

// ---------- Combine comparison ----------

export interface CombineChange {
  today: Combine
  prev: Combine | null
  score: number | null
  prevScore: number | null
  hcp: number | null
  prevHcp: number | null
  blowups: number
  prevBlowups: number | null
  excellent: number
  prevExcellent: number | null
  goodMean: number | null
  prevGoodMean: number | null
  shots: number
  targets: { target: string; score: number | null; prev: number | null; delta: number | null; fromPin: number | null; carryErr: number | null }[]
  bullets: string[]
  best: boolean
}

export const combineShots = (c: Combine) => c.targets.flatMap((t) => t.shots)
export const blowupCount = (c: Combine) => combineShots(c).filter((s) => num(s.score) && s.score < 30).length
export const excellentCount = (c: Combine) => combineShots(c).filter((s) => num(s.score) && s.score >= 80).length
export const goodMean = (c: Combine) => mean(combineShots(c).map((s) => s.score).filter((s): s is number => num(s) && s >= 30))

export function computeCombineChange(today: Combine, combines: Combine[]): CombineChange {
  const prevList = combines.filter((c) => c.date < today.date)
  const prev = prevList.length ? prevList[prevList.length - 1] : null
  const label = (t: number | 'Drive') => (t === 'Drive' ? 'Drive' : `${t} yds`)
  const targets = today.targets.map((t) => {
    const p = prev?.targets.find((x) => x.target === t.target)
    const carries = t.shots.map((s) => s.carry).filter(num)
    const carryErr = t.target !== 'Drive' && carries.length ? mean(carries)! - Number(t.target) : null
    return {
      target: label(t.target),
      score: t.target_score,
      prev: p?.target_score ?? null,
      delta: num(t.target_score) && num(p?.target_score) ? t.target_score - p!.target_score! : null,
      fromPin: t.average.from_pin ?? null,
      carryErr,
    }
  })
  const res: CombineChange = {
    today, prev, score: today.score, prevScore: prev?.score ?? null,
    hcp: today.estimated_handicap, prevHcp: prev?.estimated_handicap ?? null,
    blowups: blowupCount(today), prevBlowups: prev ? blowupCount(prev) : null,
    excellent: excellentCount(today), prevExcellent: prev ? excellentCount(prev) : null,
    goodMean: goodMean(today), prevGoodMean: prev ? goodMean(prev) : null,
    shots: combineShots(today).length, targets, bullets: [],
    best: num(today.score) && prevList.every((c) => !num(c.score) || c.score < today.score!),
  }
  const b = res.bullets
  if (!prev) {
    b.push('First Combine in the data set; this becomes the baseline.')
    return res
  }
  if (num(res.score) && num(res.prevScore)) {
    b.push(`Score ${fmt(res.score)} versus ${fmt(res.prevScore)} last time${res.best ? ', the best in the data set' : ''}; estimated handicap ${fmt(res.hcp, 1)} versus ${fmt(res.prevHcp, 1)}.`)
  }
  b.push(`Blow-ups (shots scored below 30): ${res.blowups} versus ${res.prevBlowups}. Shots scored 80 or better: ${res.excellent} versus ${res.prevExcellent}. The average of the non-blow-up shots was ${fmt(res.goodMean)} versus ${fmt(res.prevGoodMean)}, so ${Math.abs((res.goodMean ?? 0) - (res.prevGoodMean ?? 0)) < 2 ? 'the typical shot did not change; the total was set by the number of disasters' : 'the typical shot itself moved'}.`)
  const moved = targets.filter((t) => num(t.delta) && Math.abs(t.delta) >= 10).sort((a, b2) => Math.abs(b2.delta!) - Math.abs(a.delta!))
  if (moved.length) {
    b.push('Targets that moved most: ' + moved.slice(0, 4).map((t) => `${t.target} ${fmt(t.score, 0)} (${fmt(t.delta, 0, { sign: true })})`).join(', ') + '.')
  }
  const shortLong = targets.filter((t) => num(t.carryErr) && Math.abs(t.carryErr) >= 6)
  if (shortLong.length) {
    b.push('Distance misses: ' + shortLong.map((t) => `${t.target} averaged ${fmt(Math.abs(t.carryErr!), 0)} yds ${t.carryErr! < 0 ? 'short' : 'long'}`).join('; ') + '.')
  }
  return res
}
