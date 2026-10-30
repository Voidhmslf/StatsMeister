//! On-disk layout:
//!
//! ```text
//! <data_dir>/sessions/<session id>/meta.json          SessionMeta
//! <data_dir>/sessions/<session id>/telemetry.parquet  column "t" (f64) + one f32 column per channel
//! ```

pub mod export;
mod parquet_io;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sm_core::{ChannelDef, SessionInfo};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub use parquet_io::SessionWriter;

const META_FILE: &str = "meta.json";
const TELEMETRY_FILE: &str = "telemetry.parquet";

/// `STATSMEISTER_DATA` if set, otherwise the per-user app data folder
/// (`%APPDATA%\StatsMeister\data` on Windows).
pub fn default_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("STATSMEISTER_DATA") {
        return PathBuf::from(dir);
    }
    directories::ProjectDirs::from("", "", "StatsMeister")
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("statsmeister-data"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LapMeta {
    /// The game's lap counter value while driving this lap.
    pub number: u32,
    /// Frame index range `[start, end)`.
    pub start: usize,
    pub end: usize,
    pub start_t: f64,
    pub time_s: f64,
    /// `time_s` comes from the game's own timing rather than frame timestamps.
    pub official: bool,
    /// Driven from line to line (not an out lap or an interrupted lap).
    pub complete: bool,
    pub in_pit: bool,
    /// Track limits exceeded (more than two wheels off).
    pub cut: bool,
}

impl LapMeta {
    pub fn is_valid(&self) -> bool {
        self.complete && !self.in_pit && !self.cut
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    #[serde(flatten)]
    pub info: SessionInfo,
    pub source: String,
    /// RFC 3339, local time.
    pub started_at: String,
    pub duration_s: f64,
    pub frames: u64,
    pub channels: Vec<ChannelDef>,
    pub laps: Vec<LapMeta>,
    /// False while recording or if the recorder crashed.
    pub finished: bool,
}

impl SessionMeta {
    pub fn best_lap(&self) -> Option<&LapMeta> {
        self.laps
            .iter()
            .filter(|l| l.is_valid())
            .min_by(|a, b| a.time_s.total_cmp(&b.time_s))
    }

    pub fn lap(&self, number: u32) -> Option<&LapMeta> {
        self.laps.iter().find(|l| l.number == number)
    }
}

/// A fully loaded session.
#[derive(Debug, Clone)]
pub struct SessionData {
    pub meta: SessionMeta,
    pub t: Vec<f64>,
    pub channels: HashMap<String, Vec<f32>>,
}

impl SessionData {
    pub fn channel(&self, name: &str) -> Option<&[f32]> {
        self.channels.get(name).map(Vec::as_slice)
    }
}

pub fn sessions_dir(root: &Path) -> PathBuf {
    root.join("sessions")
}

fn session_dir(root: &Path, id: &str) -> PathBuf {
    sessions_dir(root).join(id)
}

pub fn new_session_id(info: &SessionInfo) -> String {
    let slug = |s: &str| -> String {
        let s: String = s
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        s.split('-')
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join("-")
    };
    format!(
        "{}_{}_{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        slug(&info.game),
        slug(&info.track)
    )
}

pub fn write_meta(root: &Path, meta: &SessionMeta) -> Result<()> {
    let dir = session_dir(root, &meta.id);
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join("meta.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(meta)?)?;
    std::fs::rename(&tmp, dir.join(META_FILE))?;
    Ok(())
}

pub fn load_meta(root: &Path, id: &str) -> Result<SessionMeta> {
    let path = session_dir(root, id).join(META_FILE);
    let bytes = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// All sessions, newest first. Unreadable entries are skipped.
pub fn list_sessions(root: &Path) -> Result<Vec<SessionMeta>> {
    let dir = sessions_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<SessionMeta> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter_map(|e| load_meta(root, &e.file_name().to_string_lossy()).ok())
        .collect();
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

pub fn load_session(root: &Path, id: &str) -> Result<SessionData> {
    let meta = load_meta(root, id)?;
    let (t, channels) = parquet_io::read(&session_dir(root, id).join(TELEMETRY_FILE))?;
    Ok(SessionData { meta, t, channels })
}

pub fn delete_session(root: &Path, id: &str) -> Result<()> {
    std::fs::remove_dir_all(session_dir(root, id))?;
    Ok(())
}

/// Creates the session folder and starts writing telemetry.
pub fn create_session(
    root: &Path,
    info: &SessionInfo,
    source: &str,
    channels: &[ChannelDef],
) -> Result<(SessionMeta, SessionWriter)> {
    let meta = SessionMeta {
        id: new_session_id(info),
        info: info.clone(),
        source: source.to_owned(),
        started_at: chrono::Local::now().to_rfc3339(),
        duration_s: 0.0,
        frames: 0,
        channels: channels.to_vec(),
        laps: Vec::new(),
        finished: false,
    };
    let dir = session_dir(root, &meta.id);
    std::fs::create_dir_all(&dir)?;
    write_meta(root, &meta)?;
    let writer = SessionWriter::create(&dir.join(TELEMETRY_FILE), channels)?;
    Ok((meta, writer))
}
