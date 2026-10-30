//! Splits a lap comparison into corners and attributes the time difference
//! to each one, with the driver inputs that explain it.
//!
//! Corners are found on the reference lap as speed minima with enough of a
//! drop before them. Each corner owns the track from the fastest point
//! before it (end of the previous straight) to the fastest point before the
//! next corner, so braking, apex and exit are all inside it.

use serde::Serialize;
use sm_core::ch;

use crate::LapComparison;

/// Minimum speed loss into a corner for it to count, km/h.
const MIN_DROP_KMH: f32 = 10.0;
/// Apexes closer than this are treated as one corner (e.g. a fast chicane), m.
const MIN_APEX_GAP_M: f32 = 80.0;
const BRAKE_ON: f32 = 0.1;
const THROTTLE_FULL: f32 = 0.9;

#[derive(Debug, Clone, Serialize)]
pub struct Corner {
    /// 1-based, in driving order.
    pub number: usize,
    /// Grid indices into `LapComparison::x`.
    pub start: usize,
    pub apex: usize,
    pub end: usize,
    pub apex_m: f32,
    /// Reference lap values, then compare lap values when present.
    pub min_speed: [Option<f32>; 2],
    /// Distance where braking starts, m.
    pub brake_m: [Option<f32>; 2],
    /// Distance where full throttle is reached after the apex, m.
    pub throttle_m: [Option<f32>; 2],
    /// Speed at the end of the corner's exit straight, km/h.
    pub exit_speed: [Option<f32>; 2],
    /// Time lost by the compare lap in this corner, s (positive = slower).
    pub delta_s: Option<f32>,
}

pub fn find_corners(cmp: &LapComparison) -> Vec<Corner> {
    let Some(speed) = cmp.reference.channels.get(ch::SPEED) else {
        return Vec::new();
    };
    let n = speed.len();
    if n < 10 || cmp.x.len() != n {
        return Vec::new();
    }
    let step = (cmp.x[n - 1] / (n - 1) as f32).max(0.01);
    let idx = |m: f32| ((m / step) as usize).max(1);

    // Local minima over ±40 m with a real drop before them.
    let w = idx(40.0);
    let mut apexes: Vec<usize> = Vec::new();
    for i in 1..n - 1 {
        let lo = i.saturating_sub(w);
        let hi = (i + w).min(n - 1);
        if speed[lo..=hi].iter().any(|&v| v < speed[i]) {
            continue;
        }
        let before_max = speed[i.saturating_sub(idx(400.0))..i]
            .iter()
            .copied()
            .fold(0.0, f32::max);
        if before_max - speed[i] < MIN_DROP_KMH {
            continue;
        }
        match apexes.last() {
            // Flat bottoms produce several equal minima; keep the first.
            Some(&prev) if cmp.x[i] - cmp.x[prev] < MIN_APEX_GAP_M => {
                if speed[i] < speed[prev] {
                    *apexes.last_mut().unwrap() = i;
                }
            }
            _ => apexes.push(i),
        }
    }

    // Boundaries: the fastest point between consecutive apexes.
    let argmax = |a: usize, b: usize| {
        (a..b)
            .max_by(|&p, &q| speed[p].total_cmp(&speed[q]))
            .unwrap_or(a)
    };
    let mut bounds = vec![0];
    for pair in apexes.windows(2) {
        bounds.push(argmax(pair[0], pair[1]));
    }
    bounds.push(n - 1);

    let laps = [Some(&cmp.reference), cmp.compare.as_ref()];
    apexes
        .iter()
        .enumerate()
        .map(|(k, &apex)| {
            let (start, end) = (bounds[k], bounds[k + 1]);
            let per_lap = |f: &dyn Fn(&crate::LapSeries) -> Option<f32>| {
                [laps[0].and_then(f), laps[1].and_then(f)]
            };
            let around = apex.saturating_sub(idx(60.0))..(apex + idx(60.0)).min(n);
            Corner {
                number: k + 1,
                start,
                apex,
                end,
                apex_m: cmp.x[apex],
                min_speed: per_lap(&|l| {
                    let s = l.channels.get(ch::SPEED)?;
                    s[around.clone()].iter().copied().reduce(f32::min)
                }),
                brake_m: per_lap(&|l| {
                    let b = l.channels.get(ch::BRAKE)?;
                    (start..=apex).find(|&i| b[i] > BRAKE_ON).map(|i| cmp.x[i])
                }),
                throttle_m: per_lap(&|l| {
                    let t = l.channels.get(ch::THROTTLE)?;
                    (apex..=end)
                        .find(|&i| t[i] >= THROTTLE_FULL)
                        .map(|i| cmp.x[i])
                }),
                exit_speed: per_lap(&|l| Some(l.channels.get(ch::SPEED)?[end])),
                delta_s: cmp.delta.as_ref().map(|d| d[end] - d[start]),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LapSeries;
    use std::collections::BTreeMap;

    fn series(speed: Vec<f32>, brake: Vec<f32>, elapsed: Vec<f32>) -> LapSeries {
        let n = speed.len();
        let mut channels = BTreeMap::new();
        channels.insert(ch::SPEED.to_owned(), speed);
        channels.insert(ch::BRAKE.to_owned(), brake);
        channels.insert(ch::THROTTLE.to_owned(), vec![1.0; n]);
        LapSeries {
            lap: 1,
            time_s: 0.0,
            elapsed,
            channels,
        }
    }

    #[test]
    fn finds_two_corners_and_attributes_delta() {
        // 1000 m at 1 m resolution, slow corners at 300 m and 700 m.
        let n = 1001;
        let x: Vec<f32> = (0..n).map(|i| i as f32).collect();
        let speed: Vec<f32> = x
            .iter()
            .map(|&m| {
                200.0
                    - 120.0 * (-((m - 300.0) / 60.0).powi(2)).exp()
                    - 100.0 * (-((m - 700.0) / 60.0).powi(2)).exp()
            })
            .collect();
        let brake_a: Vec<f32> = x
            .iter()
            .map(|&m| {
                if (220.0..290.0).contains(&m) {
                    1.0
                } else {
                    0.0
                }
            })
            .collect();
        let brake_b: Vec<f32> = x
            .iter()
            .map(|&m| {
                if (200.0..290.0).contains(&m) {
                    1.0
                } else {
                    0.0
                }
            })
            .collect();
        // B loses 0.3 s between 250 and 350 m only.
        let elapsed_b: Vec<f32> = x
            .iter()
            .map(|&m| ((m - 250.0) / 100.0).clamp(0.0, 1.0) * 0.3)
            .collect();
        let delta = elapsed_b.clone();
        let cmp = LapComparison {
            x,
            track_length_m: 1000.0,
            reference: series(speed.clone(), brake_a, vec![0.0; n]),
            compare: Some(series(speed, brake_b, elapsed_b)),
            delta: Some(delta),
            corners: Vec::new(),
            hints: Vec::new(),
        };
        let corners = find_corners(&cmp);
        assert_eq!(corners.len(), 2);
        assert!((corners[0].apex_m - 300.0).abs() < 2.0);
        assert!((corners[1].apex_m - 700.0).abs() < 2.0);
        assert!((corners[0].delta_s.unwrap() - 0.3).abs() < 1e-3);
        assert!(corners[1].delta_s.unwrap().abs() < 1e-3);
        assert_eq!(corners[0].brake_m, [Some(220.0), Some(200.0)]);
    }
}
