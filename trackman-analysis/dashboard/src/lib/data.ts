import raw from '../data/trackman.json'
import reportMd from '../data/report.md?raw'
import type { TrackmanData, Session, Combine } from '../types'

export const DATA = raw as unknown as TrackmanData
export const REPORT_MD: string = reportMd

export const SESSIONS: Session[] = [...DATA.sessions].sort((a, b) => a.date.localeCompare(b.date))
export const COMBINES: Combine[] = [...DATA.combines].sort((a, b) => a.date.localeCompare(b.date))

export const ALL_CLUBS: string[] = Array.from(new Set(SESSIONS.flatMap((s) => s.clubs.map((c) => c.club))))

/** Every date on which something happened, newest first, with what happened. */
export interface DayEntry {
  date: string
  session?: Session
  combine?: Combine
}

export const DAYS: DayEntry[] = (() => {
  const map = new Map<string, DayEntry>()
  for (const s of SESSIONS) map.set(s.date, { ...(map.get(s.date) ?? { date: s.date }), session: s })
  for (const c of COMBINES) map.set(c.date, { ...(map.get(c.date) ?? { date: c.date }), combine: c })
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date))
})()

/** Newest day that is not in the future (a misdated export should not hijack the default view). */
export function latestDay(): DayEntry {
  const today = DATA.generated
  return DAYS.find((d) => d.date <= today) ?? DAYS[0]
}

export function shotCount(sessions: Session[] = SESSIONS): number {
  return sessions.reduce((a, s) => a + s.clubs.reduce((b, c) => b + c.shots.length, 0), 0)
}
