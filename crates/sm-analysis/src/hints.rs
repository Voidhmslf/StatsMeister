//! Rule-based coaching: explains *why* the compare lap loses time in a
//! corner, from braking point, apex speed, throttle point and exit speed.
//!
//! Hints are structured (a kind plus numbers) so the UI can phrase them in
//! any language.

use serde::Serialize;

use crate::corners::Corner;

/// Corners where the compare lap loses less than this get no hint, s.
const MIN_LOSS_S: f32 = 0.05;
/// Braking point difference that counts as "earlier/later", m.
const BRAKE_M: f32 = 5.0;
/// Apex speed difference that matters, km/h.
const APEX_KMH: f32 = 2.5;
/// Full-throttle point difference that matters, m.
const THROTTLE_M: f32 = 10.0;
/// Exit speed difference that matters, km/h.
const EXIT_KMH: f32 = 3.0;
const MAX_HINTS_PER_CORNER: usize = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HintKind {
    /// The reference lap takes the corner with a lift; the compare lap brakes.
    BrakesWhereReferenceLifts,
    /// Brakes later but carries less speed through the apex.
    OverdrivenEntry { later_m: f32, slower_kmh: f32 },
    /// Starts braking earlier than needed.
    EarlyBraking { earlier_m: f32 },
    /// Slower through the apex with a similar braking point.
    SlowApex { slower_kmh: f32 },
    /// Faster at the apex but has to wait for the throttle: too much entry
    /// speed or a line that compromises the exit.
    EntrySpeedCostsExit { faster_kmh: f32, later_m: f32 },
    /// Faster at the apex but slower at the end of the exit straight: the
    /// entry speed is paid for on the exit even without a later throttle.
    FastApexSlowExit { faster_kmh: f32, slower_kmh: f32 },
    /// Reaches full throttle later.
    LateThrottle { later_m: f32 },
    /// Lower speed at the end of the exit straight.
    SlowExit { slower_kmh: f32 },
    /// Loses time but none of the inputs above differ: likely the line.
    Line,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hint {
    pub corner: usize,
    /// Time lost in the corner, s.
    pub loss_s: f32,
    #[serde(flatten)]
    pub kind: HintKind,
}

/// Hints for every corner where the compare lap loses time, biggest loss first.
pub fn corner_hints(corners: &[Corner]) -> Vec<Hint> {
    let mut out: Vec<Hint> = corners
        .iter()
        .filter(|c| c.delta_s.is_some_and(|d| d >= MIN_LOSS_S))
        .flat_map(|c| {
            explain(c)
                .into_iter()
                .take(MAX_HINTS_PER_CORNER)
                .map(|kind| Hint {
                    corner: c.number,
                    loss_s: c.delta_s.unwrap_or(0.0),
                    kind,
                })
        })
        .collect();
    out.sort_by(|a, b| b.loss_s.total_cmp(&a.loss_s).then(a.corner.cmp(&b.corner)));
    out
}

/// Differences "compare minus reference" for one corner, when both laps have the value.
fn diff(v: [Option<f32>; 2]) -> Option<f32> {
    Some(v[1]? - v[0]?)
}

/// Reasons in order of how much they explain; the first ones are the cause,
/// later ones are usually consequences.
fn explain(c: &Corner) -> Vec<HintKind> {
    let mut hints = Vec::new();
    let brake = diff(c.brake_m);
    let apex = diff(c.min_speed);
    let throttle = diff(c.throttle_m);
    let exit = diff(c.exit_speed);

    let mut entry_explained = false;
    if c.brake_m[0].is_none() && c.brake_m[1].is_some() {
        hints.push(HintKind::BrakesWhereReferenceLifts);
        entry_explained = true;
    } else if let (Some(b), Some(a)) = (brake, apex) {
        if b >= BRAKE_M && a <= -APEX_KMH {
            hints.push(HintKind::OverdrivenEntry {
                later_m: b,
                slower_kmh: -a,
            });
            entry_explained = true;
        } else if b <= -BRAKE_M {
            hints.push(HintKind::EarlyBraking { earlier_m: -b });
            entry_explained = true;
        }
    }

    match (apex, throttle) {
        (Some(a), Some(t)) if a >= APEX_KMH && t >= THROTTLE_M => {
            hints.push(HintKind::EntrySpeedCostsExit {
                faster_kmh: a,
                later_m: t,
            });
            return hints;
        }
        (Some(a), _) if a >= APEX_KMH && exit.is_some_and(|e| e <= -EXIT_KMH) => {
            hints.push(HintKind::FastApexSlowExit {
                faster_kmh: a,
                slower_kmh: -exit.unwrap_or(0.0),
            });
            return hints;
        }
        (Some(a), _) if a <= -APEX_KMH && !entry_explained => {
            hints.push(HintKind::SlowApex { slower_kmh: -a });
        }
        _ => {}
    }
    if let Some(t) = throttle.filter(|&t| t >= THROTTLE_M) {
        hints.push(HintKind::LateThrottle { later_m: t });
    }
    if let Some(e) = exit.filter(|&e| e <= -EXIT_KMH) {
        hints.push(HintKind::SlowExit { slower_kmh: -e });
    }
    if hints.is_empty() {
        hints.push(HintKind::Line);
    }
    hints
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corner(
        delta: f32,
        brake: [Option<f32>; 2],
        apex: [f32; 2],
        throttle: [f32; 2],
        exit: [f32; 2],
    ) -> Corner {
        Corner {
            number: 1,
            start: 0,
            apex: 0,
            end: 0,
            apex_m: 300.0,
            min_speed: [Some(apex[0]), Some(apex[1])],
            brake_m: brake,
            throttle_m: [Some(throttle[0]), Some(throttle[1])],
            exit_speed: [Some(exit[0]), Some(exit[1])],
            delta_s: Some(delta),
        }
    }

    fn kinds(c: Corner) -> Vec<HintKind> {
        corner_hints(&[c]).into_iter().map(|h| h.kind).collect()
    }

    #[test]
    fn overdriven_entry() {
        let k = kinds(corner(
            0.3,
            [Some(200.0), Some(207.0)],
            [100.0, 97.0],
            [350.0, 356.0],
            [200.0, 199.0],
        ));
        assert_eq!(
            k[0],
            HintKind::OverdrivenEntry {
                later_m: 7.0,
                slower_kmh: 3.0
            }
        );
        assert_eq!(k.len(), 1, "{k:?}");
    }

    #[test]
    fn slow_apex_with_same_braking() {
        let k = kinds(corner(
            0.35,
            [Some(200.0), Some(201.0)],
            [77.0, 69.5],
            [350.0, 344.0],
            [200.0, 200.0],
        ));
        assert_eq!(k, vec![HintKind::SlowApex { slower_kmh: 7.5 }]);
    }

    #[test]
    fn too_fast_in_late_on_throttle() {
        let k = kinds(corner(
            0.28,
            [Some(200.0), Some(196.0)],
            [113.0, 120.0],
            [350.0, 365.0],
            [200.0, 198.0],
        ));
        assert_eq!(
            k,
            vec![HintKind::EntrySpeedCostsExit {
                faster_kmh: 7.0,
                later_m: 15.0
            }]
        );
    }

    #[test]
    fn fast_apex_slow_exit() {
        let k = kinds(corner(
            0.27,
            [Some(200.0), Some(196.0)],
            [113.0, 120.0],
            [350.0, 347.0],
            [200.0, 189.5],
        ));
        assert_eq!(
            k,
            vec![HintKind::FastApexSlowExit {
                faster_kmh: 7.0,
                slower_kmh: 10.5
            }]
        );
    }

    #[test]
    fn braking_where_reference_lifts() {
        let k = kinds(corner(
            0.13,
            [None, Some(500.0)],
            [116.0, 106.0],
            [600.0, 582.0],
            [200.0, 200.0],
        ));
        assert_eq!(k[0], HintKind::BrakesWhereReferenceLifts);
        assert!(!k.iter().any(|h| matches!(h, HintKind::SlowApex { .. })));
    }

    #[test]
    fn late_throttle_and_slow_exit() {
        let k = kinds(corner(
            0.2,
            [Some(200.0), Some(200.0)],
            [80.0, 80.0],
            [300.0, 330.0],
            [210.0, 204.0],
        ));
        assert_eq!(
            k,
            vec![
                HintKind::LateThrottle { later_m: 30.0 },
                HintKind::SlowExit { slower_kmh: 6.0 }
            ]
        );
    }

    #[test]
    fn unexplained_loss_is_line_and_gains_are_ignored() {
        assert_eq!(
            kinds(corner(
                0.1,
                [Some(200.0), Some(200.0)],
                [80.0, 80.0],
                [300.0, 300.0],
                [200.0, 200.0]
            )),
            vec![HintKind::Line]
        );
        assert!(
            kinds(corner(
                -0.2,
                [Some(200.0), Some(190.0)],
                [80.0, 70.0],
                [300.0, 330.0],
                [200.0, 190.0]
            ))
            .is_empty()
        );
        assert!(
            kinds(corner(
                0.02,
                [Some(200.0), Some(190.0)],
                [80.0, 70.0],
                [300.0, 330.0],
                [200.0, 190.0]
            ))
            .is_empty()
        );
    }

    #[test]
    fn sorted_by_loss() {
        let mut a = corner(
            0.1,
            [Some(0.0), Some(0.0)],
            [80.0, 70.0],
            [0.0, 0.0],
            [0.0, 0.0],
        );
        let mut b = corner(
            0.4,
            [Some(0.0), Some(0.0)],
            [80.0, 70.0],
            [0.0, 0.0],
            [0.0, 0.0],
        );
        a.number = 1;
        b.number = 2;
        let h = corner_hints(&[a, b]);
        assert_eq!(h.iter().map(|h| h.corner).collect::<Vec<_>>(), vec![2, 1]);
    }
}
