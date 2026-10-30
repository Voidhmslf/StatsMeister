//! End-to-end: record demo laps, then compute the theoretical best.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[test]
fn theoretical_best_on_demo_session() {
    let dir = std::env::temp_dir().join(format!("sm-potential-test-{}", std::process::id()));
    let opts = sm_recorder::RecorderOptions {
        data_dir: dir.clone(),
        ..Default::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let stop_cb = stop.clone();
    let mut done = 0;
    let source = sm_sources::open(
        sm_sources::SourceKind::Demo,
        &sm_sources::SourceOptions { fast: true },
    );
    sm_recorder::run(source, &opts, &stop, |e| {
        if let sm_recorder::RecorderEvent::LapCompleted { .. } = e {
            done += 1;
            if done == 6 {
                stop_cb.store(true, Ordering::Relaxed);
            }
        }
    })
    .unwrap();

    let id = sm_storage::list_sessions(&dir).unwrap()[0].id.clone();
    let data = sm_storage::load_session(&dir, &id).unwrap();
    let best = data.meta.best_lap().unwrap().time_s;
    let p = sm_analysis::potential::session_potential(&data).unwrap();
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(p.reference_time_s, best);
    assert!(p.laps_used.len() >= 4, "laps used: {:?}", p.laps_used);
    assert!(p.segments.len() >= 5, "segments: {}", p.segments.len());
    // Demo laps vary per corner, so some other lap must beat the best somewhere,
    // but never by more than a couple of seconds on a ~73 s lap.
    assert!(
        p.theoretical_best_s < best,
        "{} vs {best}",
        p.theoretical_best_s
    );
    assert!(
        best - p.theoretical_best_s < 2.0,
        "{} vs {best}",
        p.theoretical_best_s
    );
    let seg_sum: f32 = p.segments.iter().map(|s| s.reference_s).sum();
    assert!(
        (seg_sum as f64 - best).abs() < 0.1,
        "segments sum {seg_sum} vs lap {best}"
    );
}
