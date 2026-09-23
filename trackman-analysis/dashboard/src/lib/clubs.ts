// Club ordering (long to short), colours and labels shared by every view.

export const CLUB_ORDER = [
  'Driver', '3Wood', '5Wood', '7Wood', '2Hybrid', '3Hybrid', '4Hybrid', '5Hybrid',
  '2Iron', '3Iron', '4Iron', '5Iron', '6Iron', '7Iron', '8Iron', '9Iron',
  'PitchingWedge', 'GapWedge', '50Wedge', '52Wedge', '54Wedge', 'SandWedge', '56Wedge', '58Wedge', '60Wedge', 'LobWedge', '62Wedge',
]

const PALETTE: Record<string, string> = {
  Driver: '#f26a1b',
  '3Wood': '#f5a623',
  '5Wood': '#ffd166',
  '3Hybrid': '#c7f464',
  '4Hybrid': '#a3e635',
  '4Iron': '#34d399',
  '5Iron': '#22c1c3',
  '6Iron': '#38bdf8',
  '7Iron': '#3b82f6',
  '8Iron': '#8b5cf6',
  '9Iron': '#d946ef',
  PitchingWedge: '#f472b6',
  GapWedge: '#fb7185',
  SandWedge: '#f87171',
  LobWedge: '#fca5a5',
}

const FALLBACK = ['#94a3b8', '#e2e8f0', '#cbd5e1', '#64748b']

export function clubColor(club: string): string {
  if (PALETTE[club]) return PALETTE[club]
  const i = CLUB_ORDER.indexOf(club)
  return FALLBACK[(i < 0 ? club.length : i) % FALLBACK.length]
}

export function clubRank(club: string): number {
  const i = CLUB_ORDER.indexOf(club)
  return i < 0 ? 999 : i
}

export function sortClubs<T extends { club: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => clubRank(a.club) - clubRank(b.club))
}

export function prettyClub(club: string): string {
  return club
    .replace(/(\d)(Iron|Wood|Hybrid|Wedge)/, '$1-$2')
    .replace('PitchingWedge', 'Pitching wedge')
    .replace('GapWedge', 'Gap wedge')
    .replace('SandWedge', 'Sand wedge')
    .replace('LobWedge', 'Lob wedge')
    .replace('-Iron', '-iron')
    .replace('-Wood', '-wood')
    .replace('-Hybrid', '-hybrid')
    .replace('-Wedge', '-wedge')
}

export function shortClub(club: string): string {
  const m = club.match(/^(\d+)(Iron|Wood|Hybrid|Wedge)$/)
  if (m) return m[1] + { Iron: 'i', Wood: 'w', Hybrid: 'h', Wedge: '°' }[m[2]]!
  return { Driver: 'Dr', PitchingWedge: 'PW', GapWedge: 'GW', SandWedge: 'SW', LobWedge: 'LW' }[club] ?? club
}
