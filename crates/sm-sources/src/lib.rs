//! Telemetry sources. Each game lives in its own module and implements
//! [`sm_core::TelemetrySource`].

pub mod ac;
pub mod auto;
pub mod demo;
#[cfg(windows)]
mod process;
#[cfg(windows)]
mod shm;

use serde::{Deserialize, Serialize};
use sm_core::TelemetrySource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    /// Detect the running game automatically.
    Auto,
    /// Assetto Corsa
    Ac,
    /// Assetto Corsa Competizione
    Acc,
    /// Synthetic data, for development without a game.
    Demo,
}

impl SourceKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "auto" => Some(Self::Auto),
            "ac" => Some(Self::Ac),
            "acc" => Some(Self::Acc),
            "demo" => Some(Self::Demo),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SourceOptions {
    /// Demo source only: generate data as fast as possible instead of real time.
    pub fast: bool,
}

pub fn open(kind: SourceKind, opts: &SourceOptions) -> Box<dyn TelemetrySource> {
    match kind {
        SourceKind::Auto => Box::new(auto::AutoSource::new()),
        SourceKind::Ac => Box::new(ac::AcSource::new(ac::Variant::Ac)),
        SourceKind::Acc => Box::new(ac::AcSource::new(ac::Variant::Acc)),
        SourceKind::Demo => Box::new(demo::DemoSource::new(opts.fast)),
    }
}

/// Games that can be detected by [`auto::AutoSource`], by executable name.
pub(crate) const KNOWN_GAMES: &[(&str, SourceKind)] = &[
    ("acs.exe", SourceKind::Ac),
    ("acs_x86.exe", SourceKind::Ac),
    ("ac2-win64-shipping.exe", SourceKind::Acc),
];

/// Returns the first known game whose process is running.
pub fn detect_running_game() -> Option<SourceKind> {
    #[cfg(windows)]
    {
        let procs = process::running_process_names();
        KNOWN_GAMES
            .iter()
            .find(|(exe, _)| procs.iter().any(|p| p == exe))
            .map(|(_, kind)| *kind)
    }
    #[cfg(not(windows))]
    {
        None
    }
}
