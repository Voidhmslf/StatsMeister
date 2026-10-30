//! Assetto Corsa and Assetto Corsa Competizione via the `acpmf_*` shared memory pages.

mod structs;

use sm_core::{ChannelDef, Poll, SessionInfo, SourceResult, TelemetrySource, ch};
use std::time::Duration;
#[cfg(windows)]
use std::time::Instant;

use structs::Physics;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    Ac,
    Acc,
}

impl Variant {
    fn game_name(self) -> &'static str {
        match self {
            Variant::Ac => "Assetto Corsa",
            Variant::Acc => "Assetto Corsa Competizione",
        }
    }

    #[cfg(windows)]
    fn exe_names(self) -> &'static [&'static str] {
        match self {
            Variant::Ac => &["acs.exe", "acs_x86.exe"],
            Variant::Acc => &["ac2-win64-shipping.exe"],
        }
    }
}

/// Values taken from the graphics page that are needed for every frame.
#[derive(Clone, Copy, Default)]
struct GraphicsSample {
    status: i32,
    completed_laps: i32,
    lap_pct: f32,
    current_ms: i32,
    last_ms: i32,
    in_pit: i32,
    pos: [f32; 3],
}

pub struct AcSource {
    variant: Variant,
    channels: Vec<ChannelDef>,
    info: SessionInfo,
    #[cfg(windows)]
    pages: Option<Pages>,
    #[cfg(windows)]
    started: Instant,
    #[cfg(windows)]
    last_packet: i32,
    #[cfg(windows)]
    last_process_check: Option<Instant>,
}

#[cfg(windows)]
struct Pages {
    physics: crate::shm::SharedMem,
    graphics: crate::shm::SharedMem,
    statics: crate::shm::SharedMem,
}

impl AcSource {
    pub fn new(variant: Variant) -> Self {
        let mut layout = LayoutSink::default();
        // SAFETY: all-zero is a valid value for these plain-old-data structs.
        let zero_physics: Physics = unsafe { std::mem::zeroed() };
        emit(&zero_physics, &GraphicsSample::default(), &mut layout);
        Self {
            variant,
            channels: layout.defs,
            info: SessionInfo::default(),
            #[cfg(windows)]
            pages: None,
            #[cfg(windows)]
            started: Instant::now(),
            #[cfg(windows)]
            last_packet: -1,
            #[cfg(windows)]
            last_process_check: None,
        }
    }
}

impl TelemetrySource for AcSource {
    fn name(&self) -> &str {
        self.variant.game_name()
    }

    fn channels(&self) -> &[ChannelDef] {
        &self.channels
    }

    fn session_info(&self) -> SessionInfo {
        self.info.clone()
    }

    fn poll_interval(&self) -> Duration {
        // ~333 Hz; frames are only emitted when the physics packet id changes.
        Duration::from_millis(3)
    }

    #[cfg(not(windows))]
    fn poll(&mut self) -> SourceResult<Poll> {
        Ok(Poll::Offline)
    }

    #[cfg(windows)]
    fn poll(&mut self) -> SourceResult<Poll> {
        // The mapping outlives the game if we hold it, so check that the
        // process is still alive every couple of seconds.
        let check_due = self
            .last_process_check
            .is_none_or(|t| t.elapsed() > Duration::from_secs(2));
        if check_due {
            self.last_process_check = Some(Instant::now());
            let procs = crate::process::running_process_names();
            let running = self
                .variant
                .exe_names()
                .iter()
                .any(|exe| procs.iter().any(|p| p == exe));
            if !running {
                self.pages = None;
                return Ok(Poll::Offline);
            }
        }

        if self.pages.is_none() {
            use crate::shm::SharedMem;
            let (Some(physics), Some(graphics), Some(statics)) = (
                SharedMem::open("Local\\acpmf_physics"),
                SharedMem::open("Local\\acpmf_graphics"),
                SharedMem::open("Local\\acpmf_static"),
            ) else {
                return Ok(Poll::Offline);
            };
            self.pages = Some(Pages {
                physics,
                graphics,
                statics,
            });
            self.last_packet = -1;
        }
        let pages = self.pages.as_ref().expect("pages opened above");

        let Some(physics) = pages.physics.read::<Physics>() else {
            return Ok(Poll::Offline);
        };
        let graphics = match self.variant {
            Variant::Ac => pages
                .graphics
                .read::<structs::AcGraphics>()
                .map(|g| graphics_sample(&g.head, g.car_coordinates)),
            Variant::Acc => pages
                .graphics
                .read::<structs::AccGraphics>()
                .map(|g| graphics_sample(&g.head, g.player_position())),
        };
        let Some(graphics) = graphics else {
            return Ok(Poll::Offline);
        };

        if graphics.status != structs::STATUS_LIVE || physics.packet_id == self.last_packet {
            return Ok(Poll::Idle);
        }
        self.last_packet = physics.packet_id;

        if let Some(st) = pages.statics.read::<structs::Static>() {
            let driver = format!(
                "{} {}",
                structs::wstr(&st.player_name),
                structs::wstr(&st.player_surname)
            );
            self.info = SessionInfo {
                game: self.variant.game_name().to_owned(),
                track: structs::wstr(&st.track),
                car: structs::wstr(&st.car_model),
                driver: driver.trim().to_owned(),
            };
        }

        let mut sink = ValueSink {
            values: Vec::with_capacity(self.channels.len()),
        };
        emit(&physics, &graphics, &mut sink);
        Ok(Poll::Frame(sm_core::Frame {
            t: self.started.elapsed().as_secs_f64(),
            values: sink.values,
        }))
    }
}

#[cfg(windows)]
fn graphics_sample(g: &structs::GraphicsHead, pos: [f32; 3]) -> GraphicsSample {
    GraphicsSample {
        status: g.status,
        completed_laps: g.completed_laps,
        lap_pct: g.normalized_car_position,
        current_ms: g.i_current_time,
        last_ms: g.i_last_time,
        in_pit: g.is_in_pit,
        pos,
    }
}

/// Receives channels in a fixed order. Used once to build the channel layout
/// and then for every frame, so the two can never get out of sync.
trait Sink {
    fn val(&mut self, name: &str, unit: &str, v: f32);
    fn wheels(&mut self, prefix: &str, unit: &str, v: [f32; 4]);
}

#[derive(Default)]
struct LayoutSink {
    defs: Vec<ChannelDef>,
}

impl Sink for LayoutSink {
    fn val(&mut self, name: &str, unit: &str, _v: f32) {
        self.defs.push(ChannelDef::new(name, unit));
    }
    fn wheels(&mut self, prefix: &str, unit: &str, _v: [f32; 4]) {
        for w in ch::WHEELS {
            self.defs
                .push(ChannelDef::new(&format!("{prefix}_{w}"), unit));
        }
    }
}

struct ValueSink {
    values: Vec<f32>,
}

impl Sink for ValueSink {
    fn val(&mut self, _name: &str, _unit: &str, v: f32) {
        self.values.push(v);
    }
    fn wheels(&mut self, _prefix: &str, _unit: &str, v: [f32; 4]) {
        self.values.extend_from_slice(&v);
    }
}

fn emit(p: &Physics, g: &GraphicsSample, s: &mut impl Sink) {
    s.val(ch::SPEED, "km/h", p.speed_kmh);
    s.val(ch::THROTTLE, "ratio", p.gas);
    s.val(ch::BRAKE, "ratio", p.brake);
    s.val(ch::CLUTCH, "ratio", p.clutch);
    s.val(ch::STEER, "norm", p.steer_angle);
    s.val(ch::GEAR, "", (p.gear - 1) as f32);
    s.val(ch::RPM, "rpm", p.rpms as f32);
    s.val(ch::G_LAT, "g", p.acc_g[0]);
    s.val(ch::G_VERT, "g", p.acc_g[1]);
    s.val(ch::G_LONG, "g", p.acc_g[2]);
    s.val(ch::LAP, "", g.completed_laps as f32);
    s.val(ch::LAP_DIST_PCT, "ratio", g.lap_pct);
    s.val(ch::LAP_TIME, "s", g.current_ms as f32 / 1000.0);
    s.val(ch::LAST_LAP_TIME, "s", g.last_ms.max(0) as f32 / 1000.0);
    s.val(ch::POS_X, "m", g.pos[0]);
    s.val(ch::POS_Y, "m", g.pos[1]);
    s.val(ch::POS_Z, "m", g.pos[2]);
    s.val(ch::IN_PIT, "", g.in_pit as f32);
    s.val(ch::TYRES_OUT, "", p.number_of_tyres_out as f32);
    s.val(ch::FUEL, "l", p.fuel);
    s.val("tc", "", p.tc);
    s.val("abs", "", p.abs);
    s.val("drs", "", p.drs);
    s.val("turbo_boost", "bar", p.turbo_boost);
    s.val("heading", "rad", p.heading);
    s.val("pitch", "rad", p.pitch);
    s.val("roll", "rad", p.roll);
    s.val("ride_height_f", "m", p.ride_height[0]);
    s.val("ride_height_r", "m", p.ride_height[1]);
    s.wheels("tyre_press", "psi", p.wheels_pressure);
    s.wheels("tyre_core_temp", "C", p.tyre_core_temperature);
    s.wheels("tyre_temp_i", "C", p.tyre_temp_i);
    s.wheels("tyre_temp_m", "C", p.tyre_temp_m);
    s.wheels("tyre_temp_o", "C", p.tyre_temp_o);
    s.wheels("tyre_wear", "", p.tyre_wear);
    s.wheels("brake_temp", "C", p.brake_temp);
    s.wheels("susp_travel", "m", p.suspension_travel);
    s.wheels("wheel_slip", "", p.wheel_slip);
    s.wheels("wheel_load", "N", p.wheel_load);
    s.wheels("wheel_speed", "rad/s", p.wheel_angular_speed);
    s.wheels("camber", "rad", p.camber_rad);
}
