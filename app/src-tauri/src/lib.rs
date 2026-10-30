//! Tauri commands exposed to the UI. All heavy lifting lives in the `sm-*` crates.

use serde::{Deserialize, Serialize};
use sm_analysis::{LapComparison, LapTrace, stats::LapStats};
use sm_core::ch;
use sm_recorder::{RecorderEvent, RecorderOptions};
use sm_sources::{SourceKind, SourceOptions};
use sm_storage::{SessionData, SessionMeta};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, State};

/// Channels sent to the UI for lap comparison charts and the track map.
const COMPARE_CHANNELS: &[&str] = &[
    ch::SPEED,
    ch::THROTTLE,
    ch::BRAKE,
    ch::STEER,
    ch::STEER_DEG,
    ch::GEAR,
    ch::RPM,
    ch::G_LAT,
    ch::G_LONG,
    ch::POS_X,
    ch::POS_Z,
];
const SESSION_CACHE_SIZE: usize = 4;

struct Recording {
    source: String,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

struct AppState {
    data_dir: PathBuf,
    cache: Mutex<HashMap<String, Arc<SessionData>>>,
    recording: Mutex<Option<Recording>>,
}

impl AppState {
    fn session(&self, id: &str) -> Result<Arc<SessionData>, String> {
        if let Some(s) = self.cache.lock().unwrap().get(id) {
            return Ok(s.clone());
        }
        let data = Arc::new(sm_storage::load_session(&self.data_dir, id).map_err(err)?);
        let mut cache = self.cache.lock().unwrap();
        if cache.len() >= SESSION_CACHE_SIZE {
            cache.clear();
        }
        cache.insert(id.to_owned(), data.clone());
        Ok(data)
    }
}

fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

#[derive(Debug, Deserialize)]
struct LapRef {
    session: String,
    lap: u32,
}

#[derive(Debug, Serialize)]
struct RecorderStatus {
    running: bool,
    source: Option<String>,
}

#[tauri::command]
fn data_dir(state: State<'_, AppState>) -> String {
    state.data_dir.display().to_string()
}

#[tauri::command]
async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionMeta>, String> {
    sm_storage::list_sessions(&state.data_dir).map_err(err)
}

#[tauri::command]
async fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.cache.lock().unwrap().remove(&id);
    sm_storage::delete_session(&state.data_dir, &id).map_err(err)
}

#[tauri::command]
async fn lap_stats(state: State<'_, AppState>, session: String) -> Result<Vec<LapStats>, String> {
    let data = state.session(&session)?;
    Ok(data
        .meta
        .laps
        .iter()
        .map(|lap| sm_analysis::stats::lap_stats(&LapTrace::new(&data, lap)))
        .collect())
}

#[tauri::command]
async fn compare_laps(
    state: State<'_, AppState>,
    reference: LapRef,
    compare: Option<LapRef>,
) -> Result<LapComparison, String> {
    let data_a = state.session(&reference.session)?;
    let lap_a = data_a
        .meta
        .lap(reference.lap)
        .ok_or_else(|| format!("lap {} not found", reference.lap))?;
    let trace_a = LapTrace::new(&data_a, lap_a);

    let data_b = compare
        .as_ref()
        .map(|c| state.session(&c.session))
        .transpose()?;
    let trace_b = match (&data_b, &compare) {
        (Some(data), Some(c)) => {
            let lap = data
                .meta
                .lap(c.lap)
                .ok_or_else(|| format!("lap {} not found", c.lap))?;
            Some(LapTrace::new(data, lap))
        }
        _ => None,
    };
    Ok(sm_analysis::compare_laps(
        &trace_a,
        trace_b.as_ref(),
        COMPARE_CHANNELS,
        1.0,
    ))
}

/// Theoretical best lap and per-corner consistency for a session.
#[tauri::command]
async fn session_potential(
    state: State<'_, AppState>,
    session: String,
) -> Result<Option<sm_analysis::potential::Potential>, String> {
    let data = state.session(&session)?;
    Ok(sm_analysis::potential::session_potential(&data))
}

/// Track + car combinations with session counts and personal bests.
#[tauri::command]
async fn list_combos(
    state: State<'_, AppState>,
) -> Result<Vec<sm_analysis::progress::Combo>, String> {
    let metas = sm_storage::list_sessions(&state.data_dir).map_err(err)?;
    Ok(sm_analysis::progress::combos(&metas))
}

/// Session-by-session history of the track + car driven in `session`.
#[tauri::command]
async fn combo_progress(
    state: State<'_, AppState>,
    session: String,
) -> Result<sm_analysis::progress::ComboProgress, String> {
    let metas = sm_storage::list_sessions(&state.data_dir).map_err(err)?;
    let meta = metas
        .iter()
        .find(|m| m.id == session)
        .ok_or_else(|| format!("session {session} not found"))?;
    let key = sm_analysis::progress::ComboKey::of(meta);
    Ok(sm_analysis::progress::combo_progress(
        &state.data_dir,
        &metas,
        &key,
    ))
}

/// Exports to `Documents\StatsMeister Exports` and returns the file path.
#[tauri::command]
async fn export_csv(
    state: State<'_, AppState>,
    session: String,
    lap: Option<u32>,
) -> Result<String, String> {
    let data = state.session(&session)?;
    let range = match lap {
        Some(n) => {
            let l = data
                .meta
                .lap(n)
                .ok_or_else(|| format!("lap {n} not found"))?;
            Some(l.start..l.end)
        }
        None => None,
    };
    let dir = directories::UserDirs::new()
        .and_then(|d| d.document_dir().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| state.data_dir.clone())
        .join("StatsMeister Exports");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let name = match lap {
        Some(n) => format!("{session}_lap{n}.csv"),
        None => format!("{session}.csv"),
    };
    let path = dir.join(name);
    let file = std::fs::File::create(&path).map_err(err)?;
    let mut w = std::io::BufWriter::new(file);
    sm_storage::export::write_csv(&data, range, &mut w).map_err(err)?;
    Ok(path.display().to_string())
}

/// Imports an Assetto Corsa replay file and returns the new session.
#[tauri::command]
async fn import_replay(state: State<'_, AppState>, path: String) -> Result<SessionMeta, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("reading {path}: {e}"))?;
    let replay = sm_sources::ac::replay::parse(&bytes).map_err(err)?;
    sm_recorder::import_frames(
        &state.data_dir,
        &replay.info,
        "Assetto Corsa replay",
        &replay.channels,
        &replay.frames,
    )
    .map_err(err)
}

#[tauri::command]
fn recorder_status(state: State<'_, AppState>) -> RecorderStatus {
    let rec = state.recording.lock().unwrap();
    RecorderStatus {
        running: rec.as_ref().is_some_and(|r| !r.thread.is_finished()),
        source: rec.as_ref().map(|r| r.source.clone()),
    }
}

#[tauri::command]
fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
) -> Result<(), String> {
    let kind = SourceKind::parse(&source).ok_or_else(|| format!("unknown source '{source}'"))?;
    let mut rec = state.recording.lock().unwrap();
    if rec.as_ref().is_some_and(|r| !r.thread.is_finished()) {
        return Err("already recording".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let opts = RecorderOptions {
        data_dir: state.data_dir.clone(),
        ..Default::default()
    };
    let thread = {
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("recorder".into())
            .spawn(move || {
                let src = sm_sources::open(kind, &SourceOptions::default());
                let emit = |e: RecorderEvent| {
                    let _ = app.emit("recorder", e);
                };
                if let Err(e) = sm_recorder::run(src, &opts, &stop, emit) {
                    let _ = app.emit("recorder", RecorderEvent::Error { message: err(e) });
                }
                let _ = app.emit("recorder-stopped", ());
            })
            .map_err(err)?
    };
    *rec = Some(Recording {
        source,
        stop,
        thread,
    });
    Ok(())
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>) -> Result<(), String> {
    let rec = state.recording.lock().unwrap().take();
    if let Some(r) = rec {
        r.stop.store(true, Ordering::Relaxed);
        r.thread
            .join()
            .map_err(|_| "recorder thread panicked".to_string())?;
    }
    Ok(())
}

pub fn run() {
    let state = AppState {
        data_dir: sm_storage::default_data_dir(),
        cache: Mutex::new(HashMap::new()),
        recording: Mutex::new(None),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            data_dir,
            list_sessions,
            delete_session,
            lap_stats,
            compare_laps,
            session_potential,
            list_combos,
            combo_progress,
            export_csv,
            import_replay,
            recorder_status,
            start_recording,
            stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StatsMeister");
}
