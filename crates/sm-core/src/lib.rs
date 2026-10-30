//! Core data model: channels, frames, session info and the `TelemetrySource` trait.
//!
//! Every game adapter converts its native telemetry into a flat list of `f32`
//! channels described by [`ChannelDef`]. Channels with well-known meaning use the
//! names from [`ch`], so analysis and UI code can work across games.

pub mod ch;

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelDef {
    pub name: String,
    pub unit: String,
}

impl ChannelDef {
    pub fn new(name: &str, unit: &str) -> Self {
        Self {
            name: name.to_owned(),
            unit: unit.to_owned(),
        }
    }
}

/// One telemetry sample. `values` is ordered exactly like the source's `channels()`.
#[derive(Debug, Clone)]
pub struct Frame {
    /// Seconds since the source connected (monotonic).
    pub t: f64,
    pub values: Vec<f32>,
}

/// Static information about what is being driven.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SessionInfo {
    pub game: String,
    pub track: String,
    pub car: String,
    pub driver: String,
}

#[derive(Debug)]
pub enum Poll {
    /// A new sample is available.
    Frame(Frame),
    /// The game is running but there is no new data (paused, menu, same packet).
    Idle,
    /// The game is not running / shared memory is not available.
    Offline,
}

#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("{0}")]
    Other(String),
}

pub type SourceResult<T> = Result<T, SourceError>;

/// A live telemetry provider (one game, or a synthetic/demo generator).
pub trait TelemetrySource: Send {
    fn name(&self) -> &str;

    /// Channel layout for every frame this source produces. Must stay stable
    /// for the lifetime of a recording session.
    fn channels(&self) -> &[ChannelDef];

    /// Current session info. Only meaningful after `poll` returned a frame.
    fn session_info(&self) -> SessionInfo;

    fn poll(&mut self) -> SourceResult<Poll>;

    /// How long the recorder should sleep between polls.
    fn poll_interval(&self) -> Duration;
}

/// Helper for sources that build frames by channel name.
#[derive(Debug, Clone)]
pub struct ChannelLayout {
    defs: Vec<ChannelDef>,
}

impl ChannelLayout {
    pub fn new(defs: Vec<ChannelDef>) -> Self {
        Self { defs }
    }

    pub fn defs(&self) -> &[ChannelDef] {
        &self.defs
    }

    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.defs.iter().position(|c| c.name == name)
    }
}
