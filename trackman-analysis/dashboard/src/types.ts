export type MetricKey =
  | 'club_speed'
  | 'ball_speed'
  | 'smash'
  | 'attack_angle'
  | 'club_path'
  | 'face_angle'
  | 'face_to_path'
  | 'launch_angle'
  | 'dynamic_loft'
  | 'spin_rate'
  | 'carry'
  | 'total'
  | 'side'
  | 'curve'

export interface Shot {
  shot: number
  warmup?: boolean
  [metric: string]: number | boolean | null | undefined
}

export interface Column {
  key: string
  label: string
  unit: string | null
}

export interface ClubBlock {
  club: string
  columns: Column[]
  shots: Shot[]
  average: Record<string, number | null>
  consistency?: Record<string, number | null>
}

export interface Session {
  id: string
  date: string
  file?: string
  pages?: number
  clubs: ClubBlock[]
  warnings: string[]
  note?: string | null
  warmup_rule?: string | null
}

export interface CombineShot {
  shot: number
  score: number | null
  club_speed?: number | null
  ball_speed?: number | null
  spin_rate?: number | null
  attack_angle?: number | null
  carry: number | null
  total?: number | null
  side: number | null
  from_pin: number | null
  [k: string]: number | null | undefined
}

export interface CombineTarget {
  target: number | 'Drive'
  target_score: number | null
  title_score?: number | null
  columns?: Column[]
  shots: CombineShot[]
  average: Record<string, number | null>
  consistency?: Record<string, number | null>
}

export interface Combine {
  id: string
  date: string
  file?: string
  score: number | null
  estimated_handicap: number | null
  targets: CombineTarget[]
  warnings: string[]
}

export interface TrackmanData {
  generated: string
  sessions: Session[]
  combines: Combine[]
}
