//! Theoretical best lap: the sum of the fastest time through every corner
//! segment across all valid laps of a session, plus how consistent each
//! segment is.
//!
//! Segments are the corners found on the best lap (each one runs from the
//! end of the previous straight to the end of its own exit straight), so
//! together they cover the whole lap. Every other valid lap is aligned to the
//! best lap by track position and timed over the same segments.

use serde::Serialize;
use sm_core::ch;
use sm_storage::SessionData;

use crate::{LapTrace, compare_laps};

/// Laps slower than this relative to the best are left out: they are almost
/// always mistakes or traffic and only add alignment noise.
const MAX_LAP_RATIO: f64 = 1.07;

#[derive(Debug, Clone, Serialize)]
pub struct SegmentStat {
    /// Corner number on the reference lap.
    pub corner: usize,
    pub start_m: f32,
    pub end_m: f32,
    /// Time through the segment on the reference (best) lap, s.
    pub reference_s: f32,
    /// Fastest time through the segment on any valid lap, s.
    pub best_s: f32,
    pub best_lap: u32,
    pub mean_s: f32,
    /// Standard deviation across laps, s. High = inconsistent corner.
    pub stdev_s: f32,
}

impl SegmentStat {
    /// Time the reference lap leaves on the table in this segment, s.
    pub fn gain_s(&self) -> f32 {
        (self.reference_s - self.best_s).max(0.0)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Potential {
    pub reference_lap: u32,
    pub reference_time_s: f64,
    pub theoretical_best_s: f64,
    pub laps_used: Vec<u32>,
    pub segments: Vec<SegmentStat>,
}

/// Segment times of one lap: `elapsed` sampled at each segment boundary.
fn segment_times(elapsed: &[f32], bounds: &[(usize, usize)]) -> Vec<f32> {
    bounds
        .iter()
        .map(|&(s, e)| elapsed[e] - elapsed[s])
        .collect()
}

/// Combines per-lap segment times (`laps[0]` is the reference) into the
/// potential. Pure, so it can be tested without real telemetry.
fn combine(
    reference_time_s: f64,
    laps: &[(u32, Vec<f32>)],
    corners: &[(usize, f32, f32)],
) -> (f64, Vec<SegmentStat>) {
    let reference = &laps[0];
    let segments: Vec<SegmentStat> = corners
        .iter()
        .enumerate()
        .map(|(k, &(corner, start_m, end_m))| {
            let times: Vec<(u32, f32)> = laps
                .iter()
                .map(|(lap, t)| (*lap, t[k]))
                .filter(|(_, t)| t.is_finite() && *t > 0.0)
                .collect();
            let (best_lap, best_s) = times
                .iter()
                .copied()
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap_or((reference.0, reference.1[k]));
            let n = times.len().max(1) as f32;
            let mean_s = times.iter().map(|(_, t)| t).sum::<f32>() / n;
            let var = times.iter().map(|(_, t)| (t - mean_s).powi(2)).sum::<f32>() / n;
            SegmentStat {
                corner,
                start_m,
                end_m,
                reference_s: reference.1[k],
                best_s,
                best_lap,
                mean_s,
                stdev_s: var.sqrt(),
            }
        })
        .collect();
    // Start from the official lap time rather than the sum of sampled
    // segment times, so frame quantization does not leak into the result.
    let gain: f64 = segments.iter().map(|s| s.gain_s() as f64).sum();
    (reference_time_s - gain, segments)
}

pub fn session_potential(data: &SessionData) -> Option<Potential> {
    let best = data.meta.best_lap()?;
    let reference = LapTrace::new(data, best);
    let laps: Vec<_> = data
        .meta
        .laps
        .iter()
        .filter(|l| l.is_valid() && l.time_s <= best.time_s * MAX_LAP_RATIO)
        .collect();

    let base = compare_laps(&reference, None, &[ch::SPEED], 1.0);
    if base.corners.is_empty() {
        return None;
    }
    let bounds: Vec<(usize, usize)> = base.corners.iter().map(|c| (c.start, c.end)).collect();

    let mut per_lap = vec![(best.number, segment_times(&base.reference.elapsed, &bounds))];
    for lap in laps.iter().filter(|l| l.number != best.number) {
        let trace = LapTrace::new(data, lap);
        let cmp = compare_laps(&reference, Some(&trace), &[], 1.0);
        if let Some(c) = cmp.compare {
            per_lap.push((lap.number, segment_times(&c.elapsed, &bounds)));
        }
    }

    let corners: Vec<(usize, f32, f32)> = base
        .corners
        .iter()
        .map(|c| (c.number, base.x[c.start], base.x[c.end]))
        .collect();
    let (theoretical_best_s, segments) = combine(best.time_s, &per_lap, &corners);
    Some(Potential {
        reference_lap: best.number,
        reference_time_s: best.time_s,
        theoretical_best_s,
        laps_used: per_lap.iter().map(|(n, _)| *n).collect(),
        segments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_fastest_segment_from_each_lap() {
        let corners = [(1, 0.0, 100.0), (2, 100.0, 200.0), (3, 200.0, 300.0)];
        let laps = vec![
            (4, vec![10.0, 20.0, 30.0]), // reference, 60.0 s
            (5, vec![9.8, 20.5, 30.1]),
            (6, vec![10.3, 20.0, 29.6]),
        ];
        let (best, segs) = combine(60.0, &laps, &corners);
        assert!((best - (60.0 - 0.2 - 0.4)).abs() < 1e-4, "{best}");
        assert_eq!(segs[0].best_lap, 5);
        assert_eq!(segs[1].best_lap, 4);
        assert_eq!(segs[2].best_lap, 6);
        assert!(segs[1].gain_s() == 0.0);
        assert!(segs[0].stdev_s > 0.0);
    }

    #[test]
    fn single_lap_has_no_gain() {
        let (best, segs) = combine(
            60.0,
            &[(1, vec![30.0, 30.0])],
            &[(1, 0.0, 1.0), (2, 1.0, 2.0)],
        );
        assert_eq!(best, 60.0);
        assert!(segs.iter().all(|s| s.stdev_s == 0.0 && s.best_lap == 1));
    }
}
