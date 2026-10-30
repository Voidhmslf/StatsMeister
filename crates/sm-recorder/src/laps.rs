use sm_core::{ChannelDef, Frame, ch};
use sm_storage::LapMeta;

/// How long to wait for the game to publish its official lap time after the
/// lap counter changes.
const OFFICIAL_TIME_WAIT_S: f64 = 3.0;

#[derive(Debug)]
pub enum LapEvent {
    /// A lap finished and its time is final.
    Completed(LapMeta),
    /// The lap counter went backwards: the session was restarted in-game.
    Reset,
}

struct CurrentLap {
    number: u32,
    start: usize,
    start_t: f64,
    from_line: bool,
    in_pit: bool,
    cut: bool,
}

struct PendingOfficial {
    lap_index: usize,
    last_time_before: f32,
    deadline: f64,
}

/// Splits a stream of frames into laps using the game's lap counter.
pub struct LapTracker {
    idx_lap: Option<usize>,
    idx_last_time: Option<usize>,
    idx_in_pit: Option<usize>,
    idx_tyres_out: Option<usize>,
    frame: usize,
    prev_last_time: f32,
    current: Option<CurrentLap>,
    pending: Option<PendingOfficial>,
    laps: Vec<LapMeta>,
}

impl LapTracker {
    pub fn new(channels: &[ChannelDef]) -> Self {
        let idx = |name: &str| channels.iter().position(|c| c.name == name);
        Self {
            idx_lap: idx(ch::LAP),
            idx_last_time: idx(ch::LAST_LAP_TIME),
            idx_in_pit: idx(ch::IN_PIT),
            idx_tyres_out: idx(ch::TYRES_OUT),
            frame: 0,
            prev_last_time: 0.0,
            current: None,
            pending: None,
            laps: Vec::new(),
        }
    }

    pub fn laps(&self) -> &[LapMeta] {
        &self.laps
    }

    pub fn current_lap_number(&self) -> Option<u32> {
        self.current.as_ref().map(|c| c.number)
    }

    pub fn push(&mut self, f: &Frame) -> Option<LapEvent> {
        let i = self.frame;
        self.frame += 1;
        let get = |idx: Option<usize>| idx.and_then(|i| f.values.get(i)).copied();
        let lap = get(self.idx_lap).unwrap_or(0.0).max(0.0) as u32;
        let last_time = get(self.idx_last_time).unwrap_or(0.0);
        let mut event = None;

        match &self.current {
            None => self.current = Some(new_lap(lap, i, f.t, false)),
            Some(cur) if lap < cur.number => {
                self.prev_last_time = last_time;
                return Some(LapEvent::Reset);
            }
            Some(cur) if lap > cur.number => {
                // A single increment is a line crossing; anything else means we
                // missed part of the session, so the new lap is not trustworthy.
                let clean = lap == cur.number + 1;
                let mut finished = self.close_current(i, f.t);
                finished.complete &= clean;
                self.laps.push(finished);
                event = self.resolve_pending(); // never leave two laps pending
                self.pending = Some(PendingOfficial {
                    lap_index: self.laps.len() - 1,
                    last_time_before: self.prev_last_time,
                    deadline: f.t + OFFICIAL_TIME_WAIT_S,
                });
                self.current = Some(new_lap(lap, i, f.t, clean));
            }
            Some(_) => {}
        }

        if let Some(cur) = self.current.as_mut() {
            cur.in_pit |= get(self.idx_in_pit).is_some_and(|v| v > 0.5);
            cur.cut |= get(self.idx_tyres_out).is_some_and(|v| v > 2.5);
        }

        if let Some(p) = &self.pending {
            let changed = (last_time - p.last_time_before).abs() > 1e-4 && last_time > 0.0;
            if changed {
                let lap = &mut self.laps[p.lap_index];
                lap.time_s = last_time as f64;
                lap.official = true;
            }
            if changed || f.t >= p.deadline {
                event = event.or(self.resolve_pending());
            }
        }

        self.prev_last_time = last_time;
        event
    }

    fn close_current(&mut self, end: usize, t: f64) -> LapMeta {
        let cur = self.current.take().expect("current lap exists");
        LapMeta {
            number: cur.number,
            start: cur.start,
            end,
            start_t: cur.start_t,
            time_s: t - cur.start_t,
            official: false,
            complete: cur.from_line,
            in_pit: cur.in_pit,
            cut: cur.cut,
        }
    }

    fn resolve_pending(&mut self) -> Option<LapEvent> {
        let p = self.pending.take()?;
        Some(LapEvent::Completed(self.laps[p.lap_index].clone()))
    }

    /// Ends the session: the lap in progress is kept but marked incomplete.
    pub fn finish(mut self, last_t: f64) -> Vec<LapMeta> {
        self.resolve_pending();
        if self.current.is_some() {
            let mut lap = self.close_current(self.frame, last_t);
            lap.complete = false;
            // Drop the stub left when recording stops right after a line crossing.
            if lap.time_s >= 1.0 {
                self.laps.push(lap);
            }
        }
        self.laps
    }
}

fn new_lap(number: u32, start: usize, start_t: f64, from_line: bool) -> CurrentLap {
    CurrentLap {
        number,
        start,
        start_t,
        from_line,
        in_pit: false,
        cut: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channels() -> Vec<ChannelDef> {
        vec![
            ChannelDef::new(ch::LAP, ""),
            ChannelDef::new(ch::LAST_LAP_TIME, "s"),
        ]
    }

    fn frame(t: f64, lap: f32, last: f32) -> Frame {
        Frame {
            t,
            values: vec![lap, last],
        }
    }

    #[test]
    fn splits_laps_and_uses_official_time() {
        let mut tr = LapTracker::new(&channels());
        let mut events = Vec::new();
        // Out lap, then lap 1 from t=10 to t=100, official time arrives one frame late.
        for (t, lap, last) in [
            (0.0, 0.0, 0.0),
            (10.0, 1.0, 0.0),
            (50.0, 1.0, 0.0),
            (100.0, 2.0, 0.0),
            (100.1, 2.0, 89.95),
            (150.0, 2.0, 89.95),
        ] {
            events.extend(tr.push(&frame(t, lap, last)));
        }
        let laps = tr.finish(150.0);
        assert_eq!(laps.len(), 3);
        assert!(!laps[0].complete, "out lap");
        assert!(laps[1].complete && laps[1].official);
        assert_eq!(laps[1].time_s as f32, 89.95);
        assert_eq!((laps[1].start, laps[1].end), (1, 3));
        assert!(!laps[2].complete, "unfinished last lap");
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn falls_back_to_frame_time() {
        let mut tr = LapTracker::new(&[ChannelDef::new(ch::LAP, "")]);
        for (t, lap) in [(0.0, 0.0), (5.0, 1.0), (95.0, 2.0), (99.0, 2.0)] {
            tr.push(&Frame {
                t,
                values: vec![lap],
            });
        }
        let laps = tr.finish(99.0);
        assert_eq!(laps[1].time_s, 90.0);
        assert!(!laps[1].official);
    }

    #[test]
    fn detects_reset() {
        let mut tr = LapTracker::new(&channels());
        tr.push(&frame(0.0, 3.0, 0.0));
        assert!(matches!(
            tr.push(&frame(1.0, 0.0, 0.0)),
            Some(LapEvent::Reset)
        ));
    }
}
