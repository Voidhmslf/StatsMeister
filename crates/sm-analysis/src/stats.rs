//! Per-lap summary numbers. Kept small and serializable so they can be shown
//! in the UI, exported, or handed to an LLM as compact context.

use crate::LapTrace;
use serde::Serialize;
use sm_core::ch;

#[derive(Debug, Default, Serialize)]
pub struct LapStats {
    pub lap: u32,
    pub time_s: f64,
    pub distance_m: f64,
    pub max_speed_kmh: f32,
    pub avg_speed_kmh: f32,
    /// Share of lap time with throttle above 98 %.
    pub full_throttle_pct: f32,
    /// Share of lap time with brake above 5 %.
    pub braking_pct: f32,
    /// Share of lap time with neither pedal pressed.
    pub coasting_pct: f32,
    pub gear_changes: u32,
    pub max_g_lat: f32,
    pub max_g_brake: f32,
}

pub fn lap_stats(trace: &LapTrace) -> LapStats {
    let mut s = LapStats {
        lap: trace.lap.number,
        time_s: trace.lap.time_s,
        distance_m: trace.dist.last().copied().unwrap_or(0.0),
        ..Default::default()
    };
    if trace.len() < 2 {
        return s;
    }
    let total_t = trace.t[trace.len() - 1] - trace.t[0];
    // Time share where `pred` holds, weighting each sample by its duration.
    let share = |pred: &dyn Fn(usize) -> bool| -> f32 {
        let mut acc = 0.0;
        for i in 1..trace.len() {
            if pred(i) {
                acc += trace.t[i] - trace.t[i - 1];
            }
        }
        (acc / total_t.max(1e-9) * 100.0) as f32
    };
    let zeros = vec![0.0f32; trace.len()];
    let thr = trace.channel(ch::THROTTLE).unwrap_or(&zeros);
    let brk = trace.channel(ch::BRAKE).unwrap_or(&zeros);

    if let Some(speed) = trace.channel(ch::SPEED) {
        s.max_speed_kmh = speed.iter().copied().fold(0.0, f32::max);
        s.avg_speed_kmh = (s.distance_m / total_t.max(1e-9) * 3.6) as f32;
    }
    s.full_throttle_pct = share(&|i| thr[i] > 0.98);
    s.braking_pct = share(&|i| brk[i] > 0.05);
    s.coasting_pct = share(&|i| thr[i] < 0.05 && brk[i] < 0.05);
    if let Some(gear) = trace.channel(ch::GEAR) {
        s.gear_changes = gear.windows(2).filter(|w| w[0] != w[1]).count() as u32;
    }
    if let Some(g) = trace.channel(ch::G_LAT) {
        s.max_g_lat = g.iter().map(|v| v.abs()).fold(0.0, f32::max);
    }
    if let Some(g) = trace.channel(ch::G_LONG) {
        s.max_g_brake = g.iter().map(|v| -v).fold(0.0, f32::max);
    }
    s
}
