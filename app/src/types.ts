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

export interface Comparison {
  x: number[];
  track_length_m: number;
  reference: LapSeries;
  compare: LapSeries | null;
  delta: number[] | null;
  corners: Corner[];
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
