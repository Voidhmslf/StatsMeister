//! Importer for Assetto Corsa replay files (`.acreplay`, format version 16).
//!
//! The format is undocumented; the layout below was reverse-engineered from
//! real replays and cross-checked against physics (speed from position
//! deltas, load transfer vs. lateral acceleration, lap counter vs. the lap
//! time table). Only the first car is imported.
//!
//! ```text
//! i32 version (16) | f64 sample interval, ms | str weather | str track | str layout
//! i32 cars | i32 current frame | i32 frames | i32 track objects
//! frames × 4 bytes of track/sun state
//! per car: str model | str driver | str nation | str team | str skin
//!          i32 frames | i32 wings | frames × 300-byte CarFrame
//!          i32 laps | laps × (u32 lap time ms, u32 flags) | ... (CSP extras)
//! ```
//! Strings are an i32 byte length followed by ASCII.

use sm_core::{ChannelDef, Frame, SessionInfo, ch};
use std::fmt;

const SUPPORTED_VERSION: i32 = 16;
const FRAME_SIZE: usize = 300;
const G: f64 = 9.81;

/// Byte offsets inside a car frame (f32 unless noted).
mod off {
    pub const POSITION: usize = 20; // 3 × f32, world m
    pub const VELOCITY: usize = 184; // 3 × f16, world m/s
    pub const RPM: usize = 190; // f16
    pub const WHEEL_SPEED: usize = 192; // 4 × f16, rad/s
    pub const WHEEL_SLIP: usize = 216; // 4 × f16, combined slip (>1 ≈ past the grip peak)
    pub const WHEEL_LOAD: usize = 224; // 4 × f16, N
    pub const STEER_DEG: usize = 232; // f16, steering wheel angle, positive = right
    pub const GEAR: usize = 254; // u8, 0 = R, 1 = N, 2 = 1st
    pub const GAS: usize = 264; // u8, 0..255
    pub const BRAKE: usize = 265; // u8, 0..255
    pub const LAP: usize = 266; // u8, laps completed
}

#[derive(Debug)]
pub struct ReplayError(String);

impl fmt::Display for ReplayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid replay: {}", self.0)
    }
}

impl std::error::Error for ReplayError {}

fn bad(msg: impl Into<String>) -> ReplayError {
    ReplayError(msg.into())
}

#[derive(Debug)]
pub struct Replay {
    pub info: SessionInfo,
    pub layout: String,
    pub weather: String,
    pub car_count: usize,
    pub sample_interval_s: f64,
    /// Lap times from the replay's own timing table, s. Index 0 is the lap
    /// that ended first (usually the out lap).
    pub lap_times: Vec<f64>,
    pub channels: Vec<ChannelDef>,
    pub frames: Vec<Frame>,
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ReplayError> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.data.len());
        let end = end.ok_or_else(|| bad(format!("unexpected end of file at byte {}", self.pos)))?;
        let s = &self.data[self.pos..end];
        self.pos = end;
        Ok(s)
    }

    fn i32(&mut self) -> Result<i32, ReplayError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, ReplayError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn f64(&mut self) -> Result<f64, ReplayError> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    /// Length-prefixed ASCII string; rejects anything that does not look like one.
    fn string(&mut self) -> Result<String, ReplayError> {
        let len = self.i32()?;
        if !(0..=256).contains(&len) {
            return Err(bad(format!("bad string length {len}")));
        }
        let bytes = self.take(len as usize)?;
        if !bytes.iter().all(|b| (0x20..0x7f).contains(b)) {
            return Err(bad("non-text string"));
        }
        Ok(String::from_utf8_lossy(bytes).into_owned())
    }
}

struct CarHeader {
    model: String,
    driver: String,
    frames: usize,
}

fn read_car_header(r: &mut Reader, expected_frames: usize) -> Result<CarHeader, ReplayError> {
    let model = r.string()?;
    let driver = r.string()?;
    let _nation = r.string()?;
    let _team = r.string()?;
    let _skin = r.string()?;
    let frames = r.i32()?;
    let wings = r.i32()?;
    if model.is_empty() || !(0..=64).contains(&wings) {
        return Err(bad("car header"));
    }
    let frames = usize::try_from(frames).map_err(|_| bad("negative frame count"))?;
    if frames + 1 < expected_frames || frames > expected_frames {
        return Err(bad("car frame count does not match the replay"));
    }
    Ok(CarHeader {
        model,
        driver,
        frames,
    })
}

pub fn parse(data: &[u8]) -> Result<Replay, ReplayError> {
    let mut r = Reader { data, pos: 0 };
    let version = r.i32()?;
    if version != SUPPORTED_VERSION {
        return Err(bad(format!(
            "unsupported replay version {version} (supported: {SUPPORTED_VERSION})"
        )));
    }
    let interval_ms = r.f64()?;
    if !(1.0..=1000.0).contains(&interval_ms) {
        return Err(bad(format!("implausible sample interval {interval_ms} ms")));
    }
    let weather = r.string()?;
    let track = r.string()?;
    let layout = r.string()?;
    let car_count = r.i32()?;
    let _current_frame = r.i32()?;
    let frame_count = usize::try_from(r.i32()?).map_err(|_| bad("negative frame count"))?;
    let _track_objects = r.i32()?;
    if car_count < 1 {
        return Err(bad("replay contains no cars"));
    }

    // Track state is 4 bytes per frame on the replays seen so far; animated
    // track objects may add more, so if the car header is not where we expect
    // it, scan forward for it.
    let track_start = r.pos;
    let expected = track_start + frame_count * 4;
    let mut header = None;
    for start in std::iter::once(expected).chain(track_start..data.len().min(expected + (8 << 20)))
    {
        let mut probe = Reader { data, pos: start };
        if let Ok(h) = read_car_header(&mut probe, frame_count) {
            header = Some((h, probe.pos));
            break;
        }
    }
    let (car, frames_start) = header.ok_or_else(|| bad("could not find the car data"))?;
    let mut r = Reader {
        data,
        pos: frames_start,
    };
    let raw = r.take(car.frames * FRAME_SIZE)?;

    // Lap time table; absent or odd tables just mean we fall back to frame timing.
    let lap_times = (|| -> Result<Vec<f64>, ReplayError> {
        let n = r.i32()?;
        if !(0..=10_000).contains(&n) {
            return Err(bad("lap table"));
        }
        (0..n)
            .map(|_| {
                let ms = r.u32()?;
                let _flags = r.u32()?;
                Ok(ms as f64 / 1000.0)
            })
            .collect()
    })()
    .unwrap_or_default();

    let dt = interval_ms / 1000.0;
    let decoded = decode_frames(raw, car.frames, dt, &lap_times);
    sanity_check(&decoded.frames, &decoded.channels)?;

    Ok(Replay {
        info: SessionInfo {
            game: "Assetto Corsa".into(),
            track: if layout.is_empty() {
                track
            } else {
                format!("{track} {layout}")
            },
            car: car.model,
            driver: car.driver,
        },
        layout,
        weather,
        car_count: car_count as usize,
        sample_interval_s: dt,
        lap_times,
        channels: decoded.channels,
        frames: decoded.frames,
    })
}

fn f16_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = ((bits >> 10) & 0x1f) as i32;
    let frac = (bits & 0x3ff) as f32;
    sign * match exp {
        0 => frac * 2f32.powi(-24),
        31 if frac == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        e => (1.0 + frac / 1024.0) * 2f32.powi(e - 15),
    }
}

struct FrameView<'a>(&'a [u8]);

impl FrameView<'_> {
    fn f32(&self, o: usize) -> f32 {
        f32::from_le_bytes(self.0[o..o + 4].try_into().unwrap())
    }
    fn f16(&self, o: usize) -> f32 {
        f16_to_f32(u16::from_le_bytes([self.0[o], self.0[o + 1]]))
    }
    fn u8(&self, o: usize) -> u8 {
        self.0[o]
    }
    fn wheels(&self, o: usize) -> [f32; 4] {
        std::array::from_fn(|i| self.f16(o + 2 * i))
    }
}

struct Decoded {
    channels: Vec<ChannelDef>,
    frames: Vec<Frame>,
}

fn decode_frames(raw: &[u8], n: usize, dt: f64, lap_times: &[f64]) -> Decoded {
    let view = |i: usize| FrameView(&raw[i * FRAME_SIZE..(i + 1) * FRAME_SIZE]);

    // Accelerations come from differentiating world velocity, then projecting
    // onto the direction of travel.
    let vel: Vec<[f64; 3]> = (0..n)
        .map(|i| {
            let f = view(i);
            std::array::from_fn(|k| f.f16(off::VELOCITY + 2 * k) as f64)
        })
        .collect();
    let (g_lat, g_long) = accelerations(&vel, dt);
    let max_steer = (0..n)
        .map(|i| view(i).f16(off::STEER_DEG).abs())
        .filter(|v| v.is_finite())
        .fold(90.0f32, f32::max);

    let mut channels: Vec<ChannelDef> = [
        (ch::SPEED, "km/h"),
        (ch::THROTTLE, "ratio"),
        (ch::BRAKE, "ratio"),
        (ch::STEER, "norm"),
        (ch::STEER_DEG, "deg"),
        (ch::GEAR, ""),
        (ch::RPM, "rpm"),
        (ch::G_LAT, "g"),
        (ch::G_LONG, "g"),
        (ch::LAP, ""),
        (ch::LAST_LAP_TIME, "s"),
        (ch::POS_X, "m"),
        (ch::POS_Y, "m"),
        (ch::POS_Z, "m"),
    ]
    .iter()
    .map(|(name, unit)| ChannelDef::new(name, unit))
    .collect();
    for (prefix, unit) in [
        ("wheel_speed", "rad/s"),
        ("wheel_load", "N"),
        ("wheel_slip", ""),
    ] {
        for w in ch::WHEELS {
            channels.push(ChannelDef::new(&format!("{prefix}_{w}"), unit));
        }
    }

    let frames = (0..n)
        .map(|i| {
            let f = view(i);
            let [vx, vy, vz] = vel[i];
            let lap = f.u8(off::LAP) as usize;
            let last_lap = if lap > 0 {
                lap_times.get(lap - 1).copied().unwrap_or(0.0)
            } else {
                0.0
            };
            let steer = f.f16(off::STEER_DEG);
            let mut values = vec![
                ((vx * vx + vy * vy + vz * vz).sqrt() * 3.6) as f32,
                f.u8(off::GAS) as f32 / 255.0,
                f.u8(off::BRAKE) as f32 / 255.0,
                steer / max_steer,
                steer,
                f.u8(off::GEAR) as f32 - 1.0,
                f.f16(off::RPM),
                g_lat[i] as f32,
                g_long[i] as f32,
                lap as f32,
                last_lap as f32,
                f.f32(off::POSITION),
                f.f32(off::POSITION + 4),
                f.f32(off::POSITION + 8),
            ];
            values.extend(f.wheels(off::WHEEL_SPEED));
            values.extend(f.wheels(off::WHEEL_LOAD));
            values.extend(f.wheels(off::WHEEL_SLIP));
            for v in &mut values {
                if !v.is_finite() {
                    *v = 0.0;
                }
            }
            Frame {
                t: i as f64 * dt,
                values,
            }
        })
        .collect();
    Decoded { channels, frames }
}

/// Lateral (positive = turning right) and longitudinal g from world velocity.
fn accelerations(vel: &[[f64; 3]], dt: f64) -> (Vec<f64>, Vec<f64>) {
    let n = vel.len();
    let mut lat = vec![0.0; n];
    let mut long = vec![0.0; n];
    for i in 1..n.saturating_sub(1) {
        let [vx, _, vz] = vel[i];
        let speed = (vx * vx + vz * vz).sqrt();
        if speed < 2.0 {
            continue;
        }
        let (fx, fz) = (vx / speed, vz / speed);
        let ax = (vel[i + 1][0] - vel[i - 1][0]) / (2.0 * dt);
        let az = (vel[i + 1][2] - vel[i - 1][2]) / (2.0 * dt);
        long[i] = (ax * fx + az * fz) / G;
        lat[i] = (fx * az - fz * ax) / G;
    }
    // f16 velocities are coarse; a short moving average keeps the traces readable.
    (smooth(&lat, 2), smooth(&long, 2))
}

fn smooth(v: &[f64], half: usize) -> Vec<f64> {
    (0..v.len())
        .map(|i| {
            let lo = i.saturating_sub(half);
            let hi = (i + half + 1).min(v.len());
            v[lo..hi].iter().sum::<f64>() / (hi - lo) as f64
        })
        .collect()
}

/// Rejects files whose bytes decode, but not into a driving car.
fn sanity_check(frames: &[Frame], channels: &[ChannelDef]) -> Result<(), ReplayError> {
    if frames.len() < 2 {
        return Err(bad("replay has no frames"));
    }
    let idx = |name: &str| channels.iter().position(|c| c.name == name).unwrap();
    let (sp, px) = (idx(ch::SPEED), idx(ch::POS_X));
    let max_speed = frames.iter().map(|f| f.values[sp]).fold(0.0, f32::max);
    let max_jump = frames
        .windows(2)
        .map(|w| (w[1].values[px] - w[0].values[px]).abs())
        .fold(0.0, f32::max);
    if max_speed > 600.0 || max_jump > 200.0 {
        return Err(bad("car data does not look like a known layout"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_floats() {
        assert_eq!(f16_to_f32(0x3c00), 1.0);
        assert_eq!(f16_to_f32(0xc000), -2.0);
        assert_eq!(f16_to_f32(0x7bff), 65504.0);
        assert_eq!(f16_to_f32(0x0001), 2f32.powi(-24));
        assert!(f16_to_f32(0x7e00).is_nan());
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse(b"").is_err());
        assert!(parse(&[0u8; 64]).is_err());
        let mut v = 16i32.to_le_bytes().to_vec();
        v.extend(30.0f64.to_le_bytes());
        v.extend([0xff; 32]);
        assert!(parse(&v).is_err());
    }

    fn put_str(v: &mut Vec<u8>, s: &str) {
        v.extend((s.len() as i32).to_le_bytes());
        v.extend(s.as_bytes());
    }

    fn put_f16(frame: &mut [u8], o: usize, x: f32) {
        // Exact for the small integers and halves used below.
        let bits = if x == 0.0 {
            0
        } else {
            let e = x.abs().log2().floor() as i32;
            let frac = ((x.abs() / 2f32.powi(e) - 1.0) * 1024.0).round() as u16;
            (if x < 0.0 { 0x8000 } else { 0 }) | (((e + 15) as u16) << 10) | frac
        };
        frame[o..o + 2].copy_from_slice(&bits.to_le_bytes());
    }

    /// Builds a replay with a car driving along +z at 20 m/s, completing a
    /// lap every 100 frames.
    fn synthetic_replay(frames: usize) -> Vec<u8> {
        let mut v = 16i32.to_le_bytes().to_vec();
        v.extend(30.0f64.to_le_bytes());
        for s in ["3_clear", "test_track", "gp"] {
            put_str(&mut v, s);
        }
        for x in [1, frames as i32, frames as i32, 0] {
            v.extend(x.to_le_bytes());
        }
        v.extend(vec![0u8; frames * 4]);
        for s in ["test_car", "Driver", "ITA", "", "skin"] {
            put_str(&mut v, s);
        }
        v.extend((frames as i32).to_le_bytes());
        v.extend(6i32.to_le_bytes());
        for i in 0..frames {
            let mut f = [0u8; FRAME_SIZE];
            let z = i as f32 * 0.6;
            f[off::POSITION + 8..off::POSITION + 12].copy_from_slice(&z.to_le_bytes());
            put_f16(&mut f, off::VELOCITY + 4, 20.0);
            put_f16(&mut f, off::RPM, 6000.0);
            put_f16(&mut f, off::STEER_DEG, -45.0);
            f[off::GEAR] = 4;
            f[off::GAS] = 255;
            f[off::LAP] = (i / 100) as u8;
            v.extend(f);
        }
        let laps = frames / 100;
        v.extend((laps as i32).to_le_bytes());
        for _ in 0..laps {
            v.extend(3000u32.to_le_bytes());
            v.extend(0x201u32.to_le_bytes());
        }
        v
    }

    #[test]
    fn parses_synthetic_replay() {
        let r = parse(&synthetic_replay(350)).unwrap();
        assert_eq!(r.info.track, "test_track gp");
        assert_eq!(r.info.car, "test_car");
        assert_eq!(r.frames.len(), 350);
        assert_eq!(r.lap_times, vec![3.0; 3]);
        assert!((r.sample_interval_s - 0.03).abs() < 1e-12);

        let get = |name: &str, i: usize| {
            let k = r.channels.iter().position(|c| c.name == name).unwrap();
            r.frames[i].values[k]
        };
        assert!((get(ch::SPEED, 10) - 72.0).abs() < 0.01);
        assert_eq!(get(ch::GEAR, 10), 3.0);
        assert_eq!(get(ch::THROTTLE, 10), 1.0);
        assert_eq!(get(ch::RPM, 10), 6000.0);
        assert_eq!(get(ch::STEER_DEG, 10), -45.0);
        assert!(get(ch::STEER, 10) < 0.0);
        assert!(get(ch::G_LAT, 10).abs() < 0.01);
        assert_eq!(get(ch::LAP, 150), 1.0);
        assert_eq!(get(ch::LAST_LAP_TIME, 150), 3.0);
        assert!((get(ch::POS_Z, 10) - 6.0).abs() < 1e-4);
        assert!(r.frames.iter().all(|f| f.values.len() == r.channels.len()));
    }

    #[test]
    fn truncated_replay_is_an_error() {
        let full = synthetic_replay(200);
        assert!(parse(&full[..full.len() / 2]).is_err());
    }

    /// Run against a real replay with
    /// `STATSMEISTER_TEST_REPLAY=path\to\file.acreplay cargo test -p sm-sources`.
    #[test]
    fn real_replay_if_available() {
        let Some(path) = std::env::var_os("STATSMEISTER_TEST_REPLAY") else {
            return;
        };
        let r = parse(&std::fs::read(path).unwrap()).unwrap();
        let k = |name: &str| r.channels.iter().position(|c| c.name == name).unwrap();
        let speed_max = r
            .frames
            .iter()
            .map(|f| f.values[k(ch::SPEED)])
            .fold(0.0, f32::max);
        assert!((50.0..450.0).contains(&speed_max), "max speed {speed_max}");
        // Lap counter changes must line up with the lap time table.
        let lap = k(ch::LAP);
        let mut starts = vec![0usize];
        starts.extend(
            (1..r.frames.len()).filter(|&i| r.frames[i].values[lap] != r.frames[i - 1].values[lap]),
        );
        for (n, w) in starts.windows(2).enumerate().skip(1) {
            let frame_time = (w[1] - w[0]) as f64 * r.sample_interval_s;
            let diff = (frame_time - r.lap_times[n]).abs();
            assert!(
                diff <= 2.0 * r.sample_interval_s,
                "lap {n}: {frame_time} vs {}",
                r.lap_times[n]
            );
        }
    }

    #[test]
    fn lateral_g_sign() {
        // Driving along +z while velocity rotates towards -x: in AC's frame
        // that is a right-hand turn, confirmed on real replays by the
        // left wheels carrying more load.
        let dt = 0.03;
        let vel: Vec<[f64; 3]> = (0..20)
            .map(|i| {
                let a = -(i as f64) * 0.02;
                [30.0 * a.sin(), 0.0, 30.0 * a.cos()]
            })
            .collect();
        let (lat, _) = accelerations(&vel, dt);
        assert!(lat[10] > 0.5, "lat = {}", lat[10]);
    }
}
