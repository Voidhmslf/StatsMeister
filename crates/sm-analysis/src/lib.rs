//! Lap-level analysis: aligning laps by track position, comparing them and
//! computing summary statistics.
//!
//! Laps are aligned on *track position* (0..1 along the lap) rather than
//! time, so the same corner lines up across laps of different pace.

pub mod corners;
pub mod stats;

use serde::Serialize;
use sm_core::ch;
use sm_storage::{LapMeta, SessionData};
use std::collections::BTreeMap;

/// The frames of one lap with derived position information.
pub struct LapTrace<'a> {
    data: &'a SessionData,
    lap: &'a LapMeta,
    /// Seconds since the lap started.
    pub t: Vec<f64>,
    /// Distance driven since the lap started, m (integrated from speed).
    pub dist: Vec<f64>,
    /// Monotonic position along the lap, nominally 0..1.
    pub pct: Vec<f64>,
    /// `pct` comes from the game rather than from integrated distance.
    pub game_pct: bool,
}

impl<'a> LapTrace<'a> {
    pub fn new(data: &'a SessionData, lap: &'a LapMeta) -> Self {
        let r = lap.start..lap.end.min(data.t.len());
        let t: Vec<f64> = data.t[r.clone()].iter().map(|&t| t - lap.start_t).collect();

        let mut dist = Vec::with_capacity(t.len());
        let mut d = 0.0;
        if let Some(speed) = data.channel(ch::SPEED) {
            let speed = &speed[r.clone()];
            for i in 0..t.len() {
                if i > 0 {
                    let v = (speed[i] + speed[i - 1]) as f64 / 2.0 / 3.6;
                    d += v * (t[i] - t[i - 1]).max(0.0);
                }
                dist.push(d);
            }
        } else {
            dist.resize(t.len(), 0.0);
        }

        let game_pct = data.channel(ch::LAP_DIST_PCT);
        let pct = match game_pct {
            Some(raw) => unwrap_pct(&raw[r]),
            None => {
                let total = dist.last().copied().unwrap_or(0.0).max(1.0);
                dist.iter().map(|d| d / total).collect()
            }
        };
        Self {
            data,
            lap,
            t,
            dist,
            pct,
            game_pct: game_pct.is_some(),
        }
    }

    pub fn channel(&self, name: &str) -> Option<&[f32]> {
        self.data
            .channel(name)
            .map(|v| &v[self.lap.start..self.lap.end.min(v.len())])
    }

    pub fn len(&self) -> usize {
        self.t.len()
    }

    pub fn is_empty(&self) -> bool {
        self.t.is_empty()
    }

    /// Estimated length of the full lap, m.
    pub fn track_length(&self) -> f64 {
        let (Some(&p0), Some(&p1)) = (self.pct.first(), self.pct.last()) else {
            return 0.0;
        };
        let covered = (p1 - p0).max(1e-3);
        self.dist.last().copied().unwrap_or(0.0) / covered
    }
}

/// Track position of every sample of `other`, expressed on `reference`'s
/// 0..1 scale, found by projecting world positions onto the reference
/// lap's driven line. Needed when the game gives no lap position (replays):
/// normalizing each lap by its own distance misaligns laps whose lines
/// differ in length.
pub fn project_onto(reference: &LapTrace, other: &LapTrace) -> Option<Vec<f64>> {
    let xy = |t: &LapTrace| -> Option<Vec<(f64, f64)>> {
        let x = t.channel(ch::POS_X)?;
        let z = t.channel(ch::POS_Z)?;
        Some(
            x.iter()
                .zip(z)
                .map(|(&x, &z)| (x as f64, z as f64))
                .collect(),
        )
    };
    let rp = xy(reference)?;
    let op = xy(other)?;
    if rp.len() < 2 || op.is_empty() {
        return None;
    }
    let m = rp.len() - 1; // number of segments

    // Distance² from q to segment j and the projection parameter along it.
    let seg = |j: usize, q: (f64, f64)| -> (f64, f64) {
        let (a, b) = (rp[j], rp[j + 1]);
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let len2 = dx * dx + dz * dz;
        let u = if len2 > 0.0 {
            (((q.0 - a.0) * dx + (q.1 - a.1) * dz) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let (px, pz) = (a.0 + u * dx, a.1 + u * dz);
        ((q.0 - px).powi(2) + (q.1 - pz).powi(2), u)
    };
    let best_in = |range: std::ops::Range<usize>, q| {
        range
            .map(|j| (j, seg(j, q)))
            .min_by(|a, b| a.1.0.total_cmp(&b.1.0))
            .map(|(j, (_, u))| (j, u))
            .expect("non-empty range")
    };

    let mut out = Vec::with_capacity(op.len());
    // The lap starts near the line, so look for the first match early in the reference.
    let (mut j, mut u) = best_in(0..m.div_ceil(5), op[0]);
    for (i, &q) in op.iter().enumerate() {
        if i > 0 {
            // Both laps are sampled similarly, so the match only moves forward a little.
            (j, u) = best_in(j.saturating_sub(5)..(j + 150).min(m), q);
        }
        let p = reference.pct[j] + u * (reference.pct[j + 1] - reference.pct[j]);
        out.push(out.last().map_or(p, |&last: &f64| last.max(p)));
    }
    Some(out)
}

/// Makes the game's 0..1 lap position continuous across the start/finish
/// line (it may wrap a few frames before or after the lap counter changes)
/// and non-decreasing.
fn unwrap_pct(raw: &[f32]) -> Vec<f64> {
    let mut out = Vec::with_capacity(raw.len());
    let mut offset = 0.0;
    let mut prev: Option<f64> = None;
    for &p in raw {
        let p = p as f64;
        match prev {
            None if p > 0.5 => offset = -1.0,
            Some(prev_raw) if prev_raw - p > 0.5 => offset += 1.0,
            Some(prev_raw) if p - prev_raw > 0.5 => offset -= 1.0,
            _ => {}
        }
        prev = Some(p);
        let v = p + offset;
        out.push(out.last().map_or(v, |&last: &f64| last.max(v)));
    }
    out
}

/// Linear interpolation of `y(x)` at each `grid` point. `x` must be non-decreasing.
fn interp<T: Copy + Into<f64>>(x: &[f64], y: &[T], grid: &[f64]) -> Vec<f64> {
    let mut out = Vec::with_capacity(grid.len());
    if x.is_empty() {
        out.resize(grid.len(), f64::NAN);
        return out;
    }
    let mut k = 0;
    for &g in grid {
        while k + 1 < x.len() && x[k + 1] <= g {
            k += 1;
        }
        let v = if g <= x[0] {
            y[0].into()
        } else if k + 1 >= x.len() {
            y[x.len() - 1].into()
        } else {
            let (x0, x1) = (x[k], x[k + 1]);
            let (y0, y1) = (y[k].into(), y[k + 1].into());
            if x1 > x0 {
                y0 + (y1 - y0) * (g - x0) / (x1 - x0)
            } else {
                y0
            }
        };
        out.push(v);
    }
    out
}

#[derive(Debug, Serialize)]
pub struct LapSeries {
    pub lap: u32,
    pub time_s: f64,
    /// Elapsed lap time at each grid point, s.
    pub elapsed: Vec<f32>,
    pub channels: BTreeMap<String, Vec<f32>>,
}

#[derive(Debug, Serialize)]
pub struct LapComparison {
    /// Distance from the start line along the reference lap, m.
    pub x: Vec<f32>,
    pub track_length_m: f64,
    pub reference: LapSeries,
    pub compare: Option<LapSeries>,
    /// `compare` elapsed time minus `reference` elapsed time; positive = compare lap is slower.
    pub delta: Option<Vec<f32>>,
    pub corners: Vec<corners::Corner>,
}

/// Resamples one or two laps onto a common distance grid of roughly `step_m` metres.
pub fn compare_laps(
    reference: &LapTrace,
    compare: Option<&LapTrace>,
    channels: &[&str],
    step_m: f64,
) -> LapComparison {
    let length = reference.track_length();
    let n = ((length / step_m.max(0.1)) as usize).clamp(200, 20_000);
    let grid: Vec<f64> = (0..=n).map(|i| i as f64 / n as f64).collect();

    let series = |trace: &LapTrace, pct: &[f64]| -> LapSeries {
        let channels = channels
            .iter()
            .filter_map(|&name| {
                let y = trace.channel(name)?;
                let v = interp(pct, y, &grid);
                Some((name.to_owned(), v.into_iter().map(|v| v as f32).collect()))
            })
            .collect();
        LapSeries {
            lap: trace.lap.number,
            time_s: trace.lap.time_s,
            elapsed: interp(pct, &trace.t, &grid)
                .into_iter()
                .map(|v| v as f32)
                .collect(),
            channels,
        }
    };

    let reference_series = series(reference, &reference.pct);
    let compare_series = compare.map(|c| {
        let projected = (!reference.game_pct || !c.game_pct)
            .then(|| project_onto(reference, c))
            .flatten();
        series(c, projected.as_deref().unwrap_or(&c.pct))
    });
    let delta = compare_series.as_ref().map(|c| {
        c.elapsed
            .iter()
            .zip(&reference_series.elapsed)
            .map(|(b, a)| b - a)
            .collect()
    });
    let mut cmp = LapComparison {
        x: grid.iter().map(|p| (p * length) as f32).collect(),
        track_length_m: length,
        reference: reference_series,
        compare: compare_series,
        delta,
        corners: Vec::new(),
    };
    cmp.corners = corners::find_corners(&cmp);
    cmp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_handles_late_and_early_wrap() {
        let p = unwrap_pct(&[0.998, 0.999, 0.001, 0.5, 0.999, 0.002]);
        assert!(p.windows(2).all(|w| w[1] >= w[0]));
        assert!((p[0] + 0.002).abs() < 1e-6);
        assert!((p[5] - 1.002).abs() < 1e-6);
    }

    #[test]
    fn interp_is_linear() {
        let v = interp(
            &[0.0, 1.0, 2.0],
            &[0.0f32, 10.0, 30.0],
            &[-1.0, 0.5, 1.5, 3.0],
        );
        assert_eq!(v, vec![0.0, 5.0, 20.0, 30.0]);
    }
}
