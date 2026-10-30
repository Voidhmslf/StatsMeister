//! The recording loop shared by the CLI and the desktop app.

mod laps;

pub use laps::{LapEvent, LapTracker};

use anyhow::Result;
use serde::Serialize;
use sm_core::{ChannelDef, Frame, Poll, SessionInfo, TelemetrySource};
use sm_storage::{LapMeta, SessionMeta, SessionWriter};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RecorderOptions {
    pub data_dir: PathBuf,
    /// End the session after this long without new frames (game paused, in menus, closed).
    pub idle_timeout: Duration,
    /// Sessions shorter than this are discarded.
    pub min_duration: Duration,
}

impl Default for RecorderOptions {
    fn default() -> Self {
        Self {
            data_dir: sm_storage::default_data_dir(),
            idle_timeout: Duration::from_secs(30),
            min_duration: Duration::from_secs(10),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RecorderEvent {
    /// No game data; waiting for the game to start or go on track.
    Waiting,
    SessionStarted {
        id: String,
        info: SessionInfo,
    },
    LapCompleted {
        session_id: String,
        lap: LapMeta,
    },
    SessionSaved {
        id: String,
        laps: usize,
        duration_s: f64,
    },
    SessionDiscarded {
        id: String,
    },
    Error {
        message: String,
    },
}

struct Active {
    meta: SessionMeta,
    writer: SessionWriter,
    tracker: LapTracker,
    first_t: f64,
    last_t: f64,
    last_frame_at: Instant,
}

/// Records until `stop` is set. Each continuous stint on track becomes one session.
pub fn run(
    mut source: Box<dyn TelemetrySource>,
    opts: &RecorderOptions,
    stop: &AtomicBool,
    mut on_event: impl FnMut(RecorderEvent),
) -> Result<()> {
    let mut active: Option<Active> = None;
    let mut waiting_reported = false;

    while !stop.load(Ordering::Relaxed) {
        match source.poll() {
            Ok(Poll::Frame(frame)) => {
                waiting_reported = false;
                let info = source.session_info();
                if active.as_ref().is_some_and(|a| a.meta.info != info) {
                    finish(active.take(), opts, &mut on_event);
                }
                if active.is_none() {
                    active = Some(start(&*source, info, &frame, opts, &mut on_event)?);
                }
                let a = active.as_mut().expect("session started above");
                match a.tracker.push(&frame) {
                    Some(LapEvent::Reset) => {
                        finish(active.take(), opts, &mut on_event);
                        let info = source.session_info();
                        let mut a = start(&*source, info, &frame, opts, &mut on_event)?;
                        record(&mut a, &frame)?;
                        active = Some(a);
                    }
                    other => {
                        if let Some(LapEvent::Completed(lap)) = other {
                            a.meta.laps = a.tracker.laps().to_vec();
                            a.meta.frames = a.writer.rows();
                            if let Err(e) = sm_storage::write_meta(&opts.data_dir, &a.meta) {
                                on_event(RecorderEvent::Error {
                                    message: format!("saving session metadata: {e:#}"),
                                });
                            }
                            on_event(RecorderEvent::LapCompleted {
                                session_id: a.meta.id.clone(),
                                lap,
                            });
                        }
                        record(a, &frame)?;
                    }
                }
            }
            Ok(Poll::Idle | Poll::Offline) => {
                if active
                    .as_ref()
                    .is_some_and(|a| a.last_frame_at.elapsed() > opts.idle_timeout)
                {
                    finish(active.take(), opts, &mut on_event);
                }
                if active.is_none() && !waiting_reported {
                    waiting_reported = true;
                    on_event(RecorderEvent::Waiting);
                }
            }
            Err(e) => {
                on_event(RecorderEvent::Error {
                    message: e.to_string(),
                });
                std::thread::sleep(Duration::from_secs(1));
            }
        }
        let interval = source.poll_interval();
        if !interval.is_zero() {
            std::thread::sleep(interval);
        }
    }
    finish(active.take(), opts, &mut on_event);
    Ok(())
}

fn start(
    source: &dyn TelemetrySource,
    info: SessionInfo,
    frame: &Frame,
    opts: &RecorderOptions,
    on_event: &mut impl FnMut(RecorderEvent),
) -> Result<Active> {
    let channels = source.channels().to_vec();
    let (meta, writer) =
        sm_storage::create_session(&opts.data_dir, &info, source.name(), &channels)?;
    on_event(RecorderEvent::SessionStarted {
        id: meta.id.clone(),
        info,
    });
    Ok(Active {
        tracker: LapTracker::new(&channels),
        meta,
        writer,
        first_t: frame.t,
        last_t: frame.t,
        last_frame_at: Instant::now(),
    })
}

fn record(a: &mut Active, frame: &Frame) -> Result<()> {
    a.writer.push(frame)?;
    a.last_t = frame.t;
    a.last_frame_at = Instant::now();
    Ok(())
}

fn finish(
    active: Option<Active>,
    opts: &RecorderOptions,
    on_event: &mut impl FnMut(RecorderEvent),
) {
    let Some(a) = active else { return };
    let Active {
        mut meta,
        writer,
        tracker,
        first_t,
        last_t,
        ..
    } = a;
    let result = (|| -> Result<()> {
        meta.frames = writer.finish()?;
        meta.laps = tracker.finish(last_t);
        meta.duration_s = last_t - first_t;
        meta.finished = true;
        if meta.duration_s < opts.min_duration.as_secs_f64() {
            sm_storage::delete_session(&opts.data_dir, &meta.id)?;
            on_event(RecorderEvent::SessionDiscarded {
                id: meta.id.clone(),
            });
        } else {
            sm_storage::write_meta(&opts.data_dir, &meta)?;
            on_event(RecorderEvent::SessionSaved {
                id: meta.id.clone(),
                laps: meta.laps.iter().filter(|l| l.complete).count(),
                duration_s: meta.duration_s,
            });
        }
        Ok(())
    })();
    if let Err(e) = result {
        on_event(RecorderEvent::Error {
            message: format!("finishing session {}: {e:#}", meta.id),
        });
    }
}

/// Stores already-captured frames (e.g. from a replay file) as one session,
/// running the same lap detection as live recording.
pub fn import_frames(
    data_dir: &Path,
    info: &SessionInfo,
    source: &str,
    channels: &[ChannelDef],
    frames: &[Frame],
) -> Result<SessionMeta> {
    let (Some(first), Some(last)) = (frames.first(), frames.last()) else {
        anyhow::bail!("nothing to import");
    };
    let (mut meta, mut writer) = sm_storage::create_session(data_dir, info, source, channels)?;
    let mut tracker = LapTracker::new(channels);
    let result = (|| -> Result<()> {
        for f in frames {
            writer.push(f)?;
            tracker.push(f);
        }
        Ok(())
    })();
    if let Err(e) = result {
        sm_storage::delete_session(data_dir, &meta.id).ok();
        return Err(e);
    }
    meta.frames = writer.finish()?;
    meta.laps = tracker.finish(last.t);
    meta.duration_s = last.t - first.t;
    meta.finished = true;
    sm_storage::write_meta(data_dir, &meta)?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn records_demo_laps() {
        let dir = std::env::temp_dir().join(format!("sm-recorder-test-{}", std::process::id()));
        let opts = RecorderOptions {
            data_dir: dir.clone(),
            ..Default::default()
        };
        let stop = Arc::new(AtomicBool::new(false));
        let mut completed = 0;
        let source = sm_sources::open(
            sm_sources::SourceKind::Demo,
            &sm_sources::SourceOptions { fast: true },
        );
        let stop2 = stop.clone();
        run(source, &opts, &stop, |e| {
            if let RecorderEvent::LapCompleted { .. } = e {
                completed += 1;
                if completed == 3 {
                    stop2.store(true, Ordering::Relaxed);
                }
            }
        })
        .unwrap();

        let sessions = sm_storage::list_sessions(&dir).unwrap();
        assert_eq!(sessions.len(), 1);
        let data = sm_storage::load_session(&dir, &sessions[0].id).unwrap();
        assert_eq!(data.t.len() as u64, data.meta.frames);
        assert_eq!(data.meta.laps.iter().filter(|l| l.is_valid()).count(), 2);
        assert!(data.meta.laps.iter().all(|l| l.official || !l.complete));
        std::fs::remove_dir_all(dir).ok();
    }
}
