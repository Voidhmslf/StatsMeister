//! Shared memory layouts of Assetto Corsa / ACC (`acpmf_*` pages).
//!
//! Only the leading part of each page is declared: it is identical between AC
//! and ACC, and later fields differ between game versions. Since we copy
//! `size_of::<T>()` bytes from the start of the mapping, extending these
//! structs is safe as long as fields are appended in the documented order.

#![allow(dead_code)]

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Physics {
    pub packet_id: i32,
    pub gas: f32,
    pub brake: f32,
    pub fuel: f32,
    /// 0 = R, 1 = N, 2 = 1st ...
    pub gear: i32,
    pub rpms: i32,
    pub steer_angle: f32,
    pub speed_kmh: f32,
    pub velocity: [f32; 3],
    /// x = lateral, y = vertical, z = longitudinal
    pub acc_g: [f32; 3],
    pub wheel_slip: [f32; 4],
    pub wheel_load: [f32; 4],
    pub wheels_pressure: [f32; 4],
    pub wheel_angular_speed: [f32; 4],
    pub tyre_wear: [f32; 4],
    pub tyre_dirty_level: [f32; 4],
    pub tyre_core_temperature: [f32; 4],
    pub camber_rad: [f32; 4],
    pub suspension_travel: [f32; 4],
    pub drs: f32,
    pub tc: f32,
    pub heading: f32,
    pub pitch: f32,
    pub roll: f32,
    pub cg_height: f32,
    pub car_damage: [f32; 5],
    pub number_of_tyres_out: i32,
    pub pit_limiter_on: i32,
    pub abs: f32,
    pub kers_charge: f32,
    pub kers_input: f32,
    pub auto_shifter_on: i32,
    pub ride_height: [f32; 2],
    pub turbo_boost: f32,
    pub ballast: f32,
    pub air_density: f32,
    pub air_temp: f32,
    pub road_temp: f32,
    pub local_angular_vel: [f32; 3],
    pub final_ff: f32,
    pub performance_meter: f32,
    pub engine_brake: i32,
    pub ers_recovery_level: i32,
    pub ers_power_level: i32,
    pub ers_heat_charging: i32,
    pub ers_is_charging: i32,
    pub kers_current_kj: f32,
    pub drs_available: i32,
    pub drs_enabled: i32,
    pub brake_temp: [f32; 4],
    pub clutch: f32,
    /// AC only (zero in ACC)
    pub tyre_temp_i: [f32; 4],
    pub tyre_temp_m: [f32; 4],
    pub tyre_temp_o: [f32; 4],
}

pub const STATUS_LIVE: i32 = 2;

/// Common head of the graphics page.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GraphicsHead {
    pub packet_id: i32,
    /// 0 off, 1 replay, 2 live, 3 pause
    pub status: i32,
    pub session: i32,
    pub current_time: [u16; 15],
    pub last_time: [u16; 15],
    pub best_time: [u16; 15],
    pub split: [u16; 15],
    pub completed_laps: i32,
    pub position: i32,
    /// ms
    pub i_current_time: i32,
    pub i_last_time: i32,
    pub i_best_time: i32,
    pub session_time_left: f32,
    pub distance_traveled: f32,
    pub is_in_pit: i32,
    pub current_sector_index: i32,
    pub last_sector_time: i32,
    pub number_of_laps: i32,
    pub tyre_compound: [u16; 33],
    pub replay_time_multiplier: f32,
    pub normalized_car_position: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AcGraphics {
    pub head: GraphicsHead,
    pub car_coordinates: [f32; 3],
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AccGraphics {
    pub head: GraphicsHead,
    pub active_cars: i32,
    pub car_coordinates: [[f32; 3]; 60],
    pub car_id: [i32; 60],
    pub player_car_id: i32,
}

impl AccGraphics {
    pub fn player_position(&self) -> [f32; 3] {
        let n = (self.active_cars.max(0) as usize).min(60);
        (0..n)
            .find(|&i| self.car_id[i] == self.player_car_id)
            .map(|i| self.car_coordinates[i])
            .unwrap_or([0.0; 3])
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Static {
    pub sm_version: [u16; 15],
    pub ac_version: [u16; 15],
    pub number_of_sessions: i32,
    pub num_cars: i32,
    pub car_model: [u16; 33],
    pub track: [u16; 33],
    pub player_name: [u16; 33],
    pub player_surname: [u16; 33],
    pub player_nick: [u16; 33],
    pub sector_count: i32,
    pub max_torque: f32,
    pub max_power: f32,
    pub max_rpm: i32,
    pub max_fuel: f32,
}

pub fn wstr(s: &[u16]) -> String {
    let len = s.iter().position(|&c| c == 0).unwrap_or(s.len());
    String::from_utf16_lossy(&s[..len]).trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Guards against accidental layout changes. Expected offsets follow
    // SharedFileOut.h compiled with `#pragma pack(4)`.
    #[test]
    fn layout_offsets() {
        assert_eq!(std::mem::offset_of!(Physics, acc_g), 44);
        assert_eq!(std::mem::offset_of!(Physics, suspension_travel), 184);
        assert_eq!(std::mem::offset_of!(GraphicsHead, completed_laps), 132);
        assert_eq!(
            std::mem::offset_of!(GraphicsHead, normalized_car_position),
            248
        );
        assert_eq!(std::mem::offset_of!(Static, sector_count), 400);
    }
}
