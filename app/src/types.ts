// Mirrors of the Rust types returned by Tauri commands (serde field names).

export interface ChannelDef {
  name: string;
  unit: string;
}

export interface Lap {
  number: number;
  start: number;
  end: number;
  start_t: number;
  time_s: number;
  official: boolean;
  complete: boolean;
  in_pit: boolean;
  cut: boolean;
}

export interface Session {
  id: string;
  game: string;
  track: string;
  car: string;
  driver: string;
  source: string;
  started_at: string;
  duration_s: number;
  frames: number;
  channels: ChannelDef[];
  laps: Lap[];
  finished: boolean;
}

export interface LapSeries {
  lap: number;
  time_s: number;
  elapsed: number[];
  channels: Record<string, number[]>;
}

export interface Corner {
  number: number;
  start: number;
  apex: number;
  end: number;
  apex_m: number;
  min_speed: [number | null, number | null];
  brake_m: [number | null, number | null];
  throttle_m: [number | null, number | null];
  exit_speed: [number | null, number | null];
  delta_s: number | null;
}

/** Why lap B loses time in a corner; numbers depend on `kind`. */
export interface Hint {
  corner: number;
  loss_s: number;
  kind:
    | "brakes_where_reference_lifts"
    | "overdriven_entry"
    | "early_braking"
    | "slow_apex"
    | "entry_speed_costs_exit"
    | "fast_apex_slow_exit"
    | "late_throttle"
    | "slow_exit"
    | "line";
  later_m?: number;
  earlier_m?: number;
  slower_kmh?: number;
  faster_kmh?: number;
}

export interface Comparison {
  x: number[];
  track_length_m: number;
  reference: LapSeries;
  compare: LapSeries | null;
  delta: number[] | null;
  corners: Corner[];
  hints: Hint[];
}

export interface LapStats {
  lap: number;
  time_s: number;
  distance_m: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  full_throttle_pct: number;
  braking_pct: number;
  coasting_pct: number;
  gear_changes: number;
  max_g_lat: number;
  max_g_brake: number;
}

export interface SegmentStat {
  corner: number;
  start_m: number;
  end_m: number;
  reference_s: number;
  best_s: number;
  best_lap: number;
  mean_s: number;
  stdev_s: number;
}

export interface Potential {
  reference_lap: number;
  reference_time_s: number;
  theoretical_best_s: number;
  laps_used: number[];
  segments: SegmentStat[];
}

export interface SessionSummary {
  id: string;
  started_at: string;
  valid_laps: number;
  best_s: number | null;
  best_lap: number | null;
  potential_s: number | null;
  median_s: number | null;
  stdev_s: number | null;
}

export interface ComboProgress {
  key: { game: string; track: string; car: string };
  sessions: SessionSummary[];
  personal_best: [string, number] | null;
}

export interface LapRef {
  session: string;
  lap: number;
}

export type RecorderEvent =
  | { type: "waiting" }
  | { type: "session_started"; id: string; info: { game: string; track: string; car: string } }
  | { type: "lap_completed"; session_id: string; lap: Lap }
  | { type: "session_saved"; id: string; laps: number; duration_s: number }
  | { type: "session_discarded"; id: string }
  | { type: "error"; message: string };

export const isValidLap = (l: Lap) => l.complete && !l.in_pit && !l.cut;
