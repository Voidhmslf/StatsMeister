//! Synthetic telemetry from a simple point-mass car on a made-up circuit.
//!
//! Lets the whole pipeline (recording, lap detection, analysis, UI) be
//! developed and tested without a game running. Every lap gets small random
//! variations in grip and braking so that lap comparisons show real deltas.

use sm_core::{ChannelDef, Frame, Poll, SessionInfo, SourceResult, TelemetrySource, ch};
use std::f64::consts::PI;
use std::time::Duration;

const G: f64 = 9.81;
const DS: f64 = 1.0; // track discretization, m
const DT: f64 = 0.01; // 100 Hz
const V_TOP: f64 = 77.0;
const POWER_W: f64 = 400_000.0;
const MASS_KG: f64 = 1300.0;
const DRAG_K: f64 = 0.45;
const LAT_G: f64 = 1.55;
const BRAKE_G: f64 = 1.6;
const WHEELBASE: f64 = 2.7;
const STEER_RATIO: f64 = 14.0;
const MAX_LOCK_RAD: f64 = 450.0 * PI / 180.0;
/// Top speed of each gear (m/s) at the shift rpm.
const GEAR_TOP: [f64; 6] = [20.0, 31.0, 43.0, 54.0, 65.0, 78.0];
const SHIFT_RPM: f64 = 8200.0;

enum Seg {
    Straight(f64),
    /// Positive angle = right turn.
    Turn {
        radius: f64,
        angle_deg: f64,
    },
}

const TRACK: &[Seg] = &[
    Seg::Straight(700.0),
    Seg::Turn {
        radius: 40.0,
        angle_deg: 90.0,
    },
    Seg::Straight(300.0),
    Seg::Turn {
        radius: 200.0,
        angle_deg: -30.0,
    },
    Seg::Turn {
        radius: 120.0,
        angle_deg: 60.0,
    },
    Seg::Straight(400.0),
    Seg::Turn {
        radius: 70.0,
        angle_deg: 120.0,
    },
    Seg::Straight(150.0),
    Seg::Turn {
        radius: 90.0,
        angle_deg: -45.0,
    },
    Seg::Turn {
        radius: 60.0,
        angle_deg: 75.0,
    },
    Seg::Straight(500.0),
    Seg::Turn {
        radius: 150.0,
        angle_deg: 90.0,
    },
    Seg::Straight(250.0),
    Seg::Turn {
        radius: 50.0,
        angle_deg: -60.0,
    },
    Seg::Turn {
        radius: 50.0,
        angle_deg: 60.0,
    },
    Seg::Straight(200.0),
];

struct Track {
    curvature: Vec<f64>,
    segment: Vec<usize>,
    x: Vec<f64>,
    z: Vec<f64>,
    length: f64,
}

impl Track {
    fn build() -> Self {
        let (mut curvature, mut segment) = (Vec::new(), Vec::new());
        for (i, seg) in TRACK.iter().enumerate() {
            let (len, k) = match *seg {
                Seg::Straight(len) => (len, 0.0),
                Seg::Turn { radius, angle_deg } => (
                    radius * angle_deg.abs().to_radians(),
                    angle_deg.signum() / radius,
                ),
            };
            for _ in 0..(len / DS).round() as usize {
                curvature.push(k);
                segment.push(i);
            }
        }
        let n = curvature.len();
        let (mut x, mut z) = (Vec::with_capacity(n), Vec::with_capacity(n));
        let (mut px, mut pz, mut heading) = (0.0_f64, 0.0_f64, 0.0_f64);
        for &k in &curvature {
            x.push(px);
            z.push(pz);
            heading -= k * DS;
            px += heading.cos() * DS;
            pz += heading.sin() * DS;
        }
        // The segment list does not close exactly; spread the gap over the lap.
        for i in 0..n {
            let f = i as f64 / n as f64;
            x[i] -= px * f;
            z[i] -= pz * f;
        }
        Self {
            curvature,
            segment,
            x,
            z,
            length: n as f64 * DS,
        }
    }

    fn len(&self) -> usize {
        self.curvature.len()
    }

    fn at(&self, v: &[f64], s: f64) -> f64 {
        let n = self.len();
        let p = s / DS;
        let i = p.floor() as usize % n;
        let f = p - p.floor();
        v[i] * (1.0 - f) + v[(i + 1) % n] * f
    }
}

/// Speed (m/s) at each track point for one lap with the given per-segment
/// grip and braking factors.
fn speed_profile(track: &Track, grip: &[f64], brake: &[f64]) -> Vec<f64> {
    let n = track.len();
    let vmax: Vec<f64> = (0..n)
        .map(|i| {
            let k = track.curvature[i].abs();
            let lat = LAT_G * G * grip[track.segment[i]];
            if k > 0.0 {
                (lat / k).sqrt().min(V_TOP)
            } else {
                V_TOP
            }
        })
        .collect();

    // Run three laps so the profile is periodic, keep the middle one.
    let mut fwd = vec![0.0; n];
    let mut v = vmax[0];
    for j in 0..3 * n {
        let i = j % n;
        let drive = (POWER_W / (MASS_KG * v.max(5.0))).min(1.0 * G);
        let drag = DRAG_K * v * v / MASS_KG;
        v = (v * v + 2.0 * (drive - drag).max(0.0) * DS)
            .sqrt()
            .min(vmax[i]);
        if j / n == 1 {
            fwd[i] = v;
        }
    }
    let mut out = vec![0.0; n];
    let mut v = vmax[0];
    for j in (0..3 * n).rev() {
        let i = j % n;
        let decel = BRAKE_G * G * brake[track.segment[i]];
        v = (v * v + 2.0 * decel * DS).sqrt().min(vmax[i]);
        if j / n == 1 {
            out[i] = v.min(fwd[i]);
        }
    }
    out
}

struct Rng(u64);

impl Rng {
    fn next_f64(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }

    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.next_f64()
    }
}

pub struct DemoSource {
    fast: bool,
    channels: Vec<ChannelDef>,
    track: Track,
    rng: Rng,
    profile: Vec<f64>,
    t: f64,
    s: f64,
    lap: u32,
    lap_time: f64,
    last_lap_time: f64,
    throttle: f64,
    brake: f64,
    gear: usize,
    fuel: f64,
    tyre_temp: [f64; 4],
}

impl DemoSource {
    pub fn new(fast: bool) -> Self {
        let mut channels: Vec<ChannelDef> = [
            (ch::SPEED, "km/h"),
            (ch::THROTTLE, "ratio"),
            (ch::BRAKE, "ratio"),
            (ch::CLUTCH, "ratio"),
            (ch::STEER, "norm"),
            (ch::GEAR, ""),
            (ch::RPM, "rpm"),
            (ch::G_LAT, "g"),
            (ch::G_LONG, "g"),
            (ch::LAP, ""),
            (ch::LAP_DIST_PCT, "ratio"),
            (ch::LAP_TIME, "s"),
            (ch::LAST_LAP_TIME, "s"),
            (ch::POS_X, "m"),
            (ch::POS_Y, "m"),
            (ch::POS_Z, "m"),
            (ch::IN_PIT, ""),
            (ch::TYRES_OUT, ""),
            (ch::FUEL, "l"),
        ]
        .iter()
        .map(|(n, u)| ChannelDef::new(n, u))
        .collect();
        for w in ch::WHEELS {
            channels.push(ChannelDef::new(&format!("tyre_core_temp_{w}"), "C"));
        }

        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15)
            | 1;
        let track = Track::build();
        let mut src = Self {
            fast,
            channels,
            // Start late in the lap so the first (out) lap is partial, like in a real session.
            s: track.length * 0.85,
            track,
            rng: Rng(seed),
            profile: Vec::new(),
            t: 0.0,
            lap: 0,
            lap_time: 0.0,
            last_lap_time: 0.0,
            throttle: 0.0,
            brake: 0.0,
            gear: 1,
            fuel: 60.0,
            tyre_temp: [65.0; 4],
        };
        src.new_lap_profile();
        src
    }

    fn new_lap_profile(&mut self) {
        let grip: Vec<f64> = TRACK.iter().map(|_| self.rng.range(0.94, 1.0)).collect();
        let brake: Vec<f64> = TRACK.iter().map(|_| self.rng.range(0.86, 1.0)).collect();
        self.profile = speed_profile(&self.track, &grip, &brake);
    }

    fn step(&mut self) -> Frame {
        let v = self.track.at(&self.profile, self.s);
        let v_next = self.track.at(&self.profile, self.s + DS);
        let accel = (v_next * v_next - v * v) / (2.0 * DS);
        let k = self.track.at(&self.track.curvature, self.s);

        // Pedal targets, then rate-limit them like a human foot would.
        let (thr_target, brk_target) = if accel < -0.5 {
            (0.0, (-accel / (BRAKE_G * G)).min(1.0))
        } else if accel > 0.3 {
            (1.0, 0.0)
        } else {
            (0.45, 0.0)
        };
        self.throttle += (thr_target - self.throttle).clamp(-DT / 0.1, DT / 0.08);
        self.brake += (brk_target - self.brake).clamp(-DT / 0.12, DT / 0.05);

        if v > GEAR_TOP[self.gear - 1] * 0.98 && self.gear < GEAR_TOP.len() {
            self.gear += 1;
        } else if self.gear > 1 && v < GEAR_TOP[self.gear - 2] * 0.7 {
            self.gear -= 1;
        }
        let rpm = (v / GEAR_TOP[self.gear - 1] * SHIFT_RPM).max(2500.0);

        let g_lat = v * v * k / G;
        let g_long = accel / G;
        let steer = ((WHEELBASE * k).atan() * STEER_RATIO / MAX_LOCK_RAD).clamp(-1.0, 1.0);

        // Right turns load the left tyres; braking loads the fronts.
        let load = [
            1.0 + g_lat.max(0.0) - g_long.min(0.0),
            1.0 - g_lat.min(0.0) - g_long.min(0.0),
            1.0 + g_lat.max(0.0) + g_long.max(0.0),
            1.0 - g_lat.min(0.0) + g_long.max(0.0),
        ];
        for (t, l) in self.tyre_temp.iter_mut().zip(load) {
            *t += (l * l * 0.45 - (*t - 25.0) * 0.012) * DT;
        }
        self.fuel = (self.fuel - self.throttle * 0.035 * DT).max(0.0);

        let frame = Frame {
            t: self.t,
            values: {
                let mut v_out = vec![
                    (v * 3.6) as f32,
                    self.throttle as f32,
                    self.brake as f32,
                    0.0,
                    steer as f32,
                    self.gear as f32,
                    rpm as f32,
                    g_lat as f32,
                    g_long as f32,
                    self.lap as f32,
                    (self.s / self.track.length) as f32,
                    self.lap_time as f32,
                    self.last_lap_time as f32,
                    self.track.at(&self.track.x, self.s) as f32,
                    0.0,
                    self.track.at(&self.track.z, self.s) as f32,
                    0.0,
                    0.0,
                    self.fuel as f32,
                ];
                v_out.extend(self.tyre_temp.iter().map(|&t| t as f32));
                v_out
            },
        };

        self.t += DT;
        self.lap_time += DT;
        self.s += v * DT;
        if self.s >= self.track.length {
            self.s -= self.track.length;
            // Correct for the part of the step that was already on the new lap.
            let overshoot = self.s / v.max(1.0);
            self.last_lap_time = self.lap_time - overshoot;
            self.lap_time = overshoot;
            self.lap += 1;
            self.new_lap_profile();
        }
        frame
    }
}

impl TelemetrySource for DemoSource {
    fn name(&self) -> &str {
        "Demo"
    }

    fn channels(&self) -> &[ChannelDef] {
        &self.channels
    }

    fn session_info(&self) -> SessionInfo {
        SessionInfo {
            game: "Demo".into(),
            track: "Demo Ring".into(),
            car: "Demo GT3".into(),
            driver: "Demo Driver".into(),
        }
    }

    fn poll(&mut self) -> SourceResult<Poll> {
        Ok(Poll::Frame(self.step()))
    }

    fn poll_interval(&self) -> Duration {
        if self.fast {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(DT)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_match_channel_layout() {
        let mut src = DemoSource::new(true);
        let n = src.channels().len();
        for _ in 0..100 {
            let Poll::Frame(f) = src.poll().unwrap() else {
                panic!("demo always produces frames")
            };
            assert_eq!(f.values.len(), n);
        }
    }

    #[test]
    fn lap_time_is_plausible() {
        let mut src = DemoSource::new(true);
        let mut prev_lap = 0.0;
        for _ in 0..(400.0 / DT) as usize {
            let Poll::Frame(f) = src.poll().unwrap() else {
                unreachable!()
            };
            let lap = f.values[9];
            if lap >= 2.0 && prev_lap < 2.0 {
                let t = f.values[12];
                assert!((60.0..180.0).contains(&t), "lap time {t}");
                return;
            }
            prev_lap = lap;
        }
        panic!("never completed a full lap");
    }
}
