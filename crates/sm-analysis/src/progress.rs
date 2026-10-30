//! Progress over time for each track + car combination: one summary per
//! session (best lap, theoretical best, consistency), cached on disk so the
//! history opens without re-reading every session's telemetry.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sm_storage::{SessionData, SessionMeta};
use std::path::Path;

use crate::potential::session_potential;

/// Bump when the summary computation changes so cached files are rebuilt.
pub const SUMMARY_VERSION: u32 = 1;
const CACHE_NAME: &str = "summary";
/// Laps slower than this relative to the session best don't count towards
/// consistency (out of the ordinary: traffic, mistakes, cool-down).
const CONSISTENCY_RATIO: f64 = 1.07;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub version: u32,
    pub id: String,
    pub started_at: String,
    pub valid_laps: usize,
    pub best_s: Option<f64>,
    pub best_lap: Option<u32>,
    pub potential_s: Option<f64>,
    /// Median of valid laps within 107 % of the best, s.
    pub median_s: Option<f64>,
    /// Standard deviation of the same laps, s.
    pub stdev_s: Option<f64>,
}

pub fn summarize(data: &SessionData) -> SessionSummary {
    let meta = &data.meta;
    let best = meta.best_lap();
    let mut times: Vec<f64> = meta
        .laps
        .iter()
        .filter(|l| l.is_valid())
        .map(|l| l.time_s)
        .filter(|&t| best.is_some_and(|b| t <= b.time_s * CONSISTENCY_RATIO))
        .collect();
    times.sort_by(f64::total_cmp);
    let (median_s, stdev_s) = if times.is_empty() {
        (None, None)
    } else {
        let n = times.len();
        let median = if n % 2 == 1 {
            times[n / 2]
        } else {
            (times[n / 2 - 1] + times[n / 2]) / 2.0
        };
        let mean = times.iter().sum::<f64>() / n as f64;
        let var = times.iter().map(|t| (t - mean).powi(2)).sum::<f64>() / n as f64;
        (Some(median), Some(var.sqrt()))
    };
    SessionSummary {
        version: SUMMARY_VERSION,
        id: meta.id.clone(),
        started_at: meta.started_at.clone(),
        valid_laps: meta.laps.iter().filter(|l| l.is_valid()).count(),
        best_s: best.map(|l| l.time_s),
        best_lap: best.map(|l| l.number),
        potential_s: session_potential(data).map(|p| p.theoretical_best_s),
        median_s,
        stdev_s,
    }
}

/// Summary from the cache, or computed from telemetry and cached.
pub fn cached_summary(root: &Path, meta: &SessionMeta) -> Result<SessionSummary> {
    if let Some(s) = sm_storage::read_cache::<SessionSummary>(root, &meta.id, CACHE_NAME)
        && s.version == SUMMARY_VERSION
    {
        return Ok(s);
    }
    let data = sm_storage::load_session(root, &meta.id)?;
    let summary = summarize(&data);
    // A failed cache write only costs time on the next open.
    let _ = sm_storage::write_cache(root, &meta.id, CACHE_NAME, &summary);
    Ok(summary)
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ComboKey {
    pub game: String,
    pub track: String,
    pub car: String,
}

impl ComboKey {
    pub fn of(meta: &SessionMeta) -> Self {
        Self {
            game: meta.info.game.clone(),
            track: meta.info.track.clone(),
            car: meta.info.car.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Combo {
    #[serde(flatten)]
    pub key: ComboKey,
    pub sessions: usize,
    pub last_started_at: String,
    pub best_s: Option<f64>,
}

/// Track + car combinations from session metadata, most recently driven first.
pub fn combos(metas: &[SessionMeta]) -> Vec<Combo> {
    let mut out: Vec<Combo> = Vec::new();
    for m in metas.iter().filter(|m| m.finished) {
        let key = ComboKey::of(m);
        let best = m.best_lap().map(|l| l.time_s);
        match out.iter_mut().find(|c| c.key == key) {
            Some(c) => {
                c.sessions += 1;
                if m.started_at > c.last_started_at {
                    c.last_started_at = m.started_at.clone();
                }
                c.best_s = match (c.best_s, best) {
                    (Some(a), Some(b)) => Some(a.min(b)),
                    (a, b) => a.or(b),
                };
            }
            None => out.push(Combo {
                key,
                sessions: 1,
                last_started_at: m.started_at.clone(),
                best_s: best,
            }),
        }
    }
    out.sort_by(|a, b| b.last_started_at.cmp(&a.last_started_at));
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct ComboProgress {
    pub key: ComboKey,
    /// Oldest first.
    pub sessions: Vec<SessionSummary>,
    /// Session holding the personal best and its lap time.
    pub personal_best: Option<(String, f64)>,
}

/// History of one combination. Sessions whose telemetry can't be read are skipped.
pub fn combo_progress(root: &Path, metas: &[SessionMeta], key: &ComboKey) -> ComboProgress {
    let mut sessions: Vec<SessionSummary> = metas
        .iter()
        .filter(|m| m.finished && ComboKey::of(m) == *key)
        .filter_map(|m| cached_summary(root, m).ok())
        .collect();
    sessions.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    let personal_best = sessions
        .iter()
        .filter_map(|s| Some((s.id.clone(), s.best_s?)))
        .min_by(|a, b| a.1.total_cmp(&b.1));
    ComboProgress {
        key: key.clone(),
        sessions,
        personal_best,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sm_core::SessionInfo;
    use sm_storage::LapMeta;

    fn meta(id: &str, started: &str, track: &str, laps: &[f64]) -> SessionMeta {
        SessionMeta {
            id: id.into(),
            info: SessionInfo {
                game: "Assetto Corsa".into(),
                track: track.into(),
                car: "gt3".into(),
                driver: String::new(),
            },
            source: "test".into(),
            started_at: started.into(),
            duration_s: 0.0,
            frames: 0,
            channels: Vec::new(),
            laps: laps
                .iter()
                .enumerate()
                .map(|(i, &t)| LapMeta {
                    number: i as u32 + 1,
                    start: 0,
                    end: 0,
                    start_t: 0.0,
                    time_s: t,
                    official: true,
                    complete: true,
                    in_pit: false,
                    cut: false,
                })
                .collect(),
            finished: true,
        }
    }

    #[test]
    fn groups_combos_and_keeps_best() {
        let metas = vec![
            meta("a", "2026-10-01T10:00:00+05:00", "spa", &[140.0, 139.0]),
            meta("b", "2026-10-03T10:00:00+05:00", "spa", &[138.5]),
            meta("c", "2026-10-02T10:00:00+05:00", "monza", &[110.0]),
        ];
        let c = combos(&metas);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].key.track, "spa");
        assert_eq!(c[0].sessions, 2);
        assert_eq!(c[0].best_s, Some(138.5));
        assert_eq!(c[0].last_started_at, "2026-10-03T10:00:00+05:00");
    }

    #[test]
    fn consistency_ignores_outliers() {
        let data = SessionData {
            meta: meta(
                "a",
                "2026-10-01T10:00:00+05:00",
                "spa",
                &[100.0, 101.0, 102.0, 130.0],
            ),
            t: Vec::new(),
            channels: Default::default(),
        };
        let s = summarize(&data);
        assert_eq!(s.best_s, Some(100.0));
        assert_eq!(s.valid_laps, 4);
        assert_eq!(s.median_s, Some(101.0));
        assert!((s.stdev_s.unwrap() - (2.0f64 / 3.0).sqrt()).abs() < 1e-9);
        assert_eq!(s.potential_s, None, "no telemetry, no potential");
    }
}
