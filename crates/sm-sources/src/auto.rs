//! Picks the right adapter for whichever supported game is running.

use crate::{SourceKind, SourceOptions};
use sm_core::{ChannelDef, Poll, SessionInfo, SourceResult, TelemetrySource};
use std::time::{Duration, Instant};

pub struct AutoSource {
    inner: Option<(SourceKind, Box<dyn TelemetrySource>)>,
    last_detect: Option<Instant>,
}

impl AutoSource {
    pub fn new() -> Self {
        Self {
            inner: None,
            last_detect: None,
        }
    }
}

impl Default for AutoSource {
    fn default() -> Self {
        Self::new()
    }
}

impl TelemetrySource for AutoSource {
    fn name(&self) -> &str {
        self.inner.as_ref().map_or("Auto", |(_, s)| s.name())
    }

    fn channels(&self) -> &[ChannelDef] {
        self.inner.as_ref().map_or(&[], |(_, s)| s.channels())
    }

    fn session_info(&self) -> SessionInfo {
        self.inner
            .as_ref()
            .map(|(_, s)| s.session_info())
            .unwrap_or_default()
    }

    fn poll_interval(&self) -> Duration {
        self.inner
            .as_ref()
            .map_or(Duration::from_millis(250), |(_, s)| s.poll_interval())
    }

    fn poll(&mut self) -> SourceResult<Poll> {
        if let Some((_, src)) = self.inner.as_mut() {
            match src.poll()? {
                Poll::Offline => self.inner = None,
                other => return Ok(other),
            }
        }

        if self
            .last_detect
            .is_some_and(|t| t.elapsed() < Duration::from_secs(2))
        {
            return Ok(Poll::Offline);
        }
        self.last_detect = Some(Instant::now());
        if let Some(kind) = crate::detect_running_game() {
            self.inner = Some((kind, crate::open(kind, &SourceOptions::default())));
        }
        Ok(Poll::Offline)
    }
}
