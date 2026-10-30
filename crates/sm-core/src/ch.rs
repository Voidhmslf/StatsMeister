//! Well-known channel names. Adapters should use these when the game exposes
//! the corresponding value, in the documented unit.

/// km/h
pub const SPEED: &str = "speed";
/// 0..1
pub const THROTTLE: &str = "throttle";
/// 0..1
pub const BRAKE: &str = "brake";
/// 0..1
pub const CLUTCH: &str = "clutch";
/// Normalized steering input, -1..1 (negative = left)
pub const STEER: &str = "steer";
/// -1 = reverse, 0 = neutral, 1.. = gears
pub const GEAR: &str = "gear";
pub const RPM: &str = "rpm";
/// g
pub const G_LAT: &str = "g_lat";
/// g
pub const G_LONG: &str = "g_long";
/// g
pub const G_VERT: &str = "g_vert";
/// Completed laps counter as reported by the game.
pub const LAP: &str = "lap";
/// Position along the lap, 0..1
pub const LAP_DIST_PCT: &str = "lap_dist_pct";
/// Current lap time, s
pub const LAP_TIME: &str = "lap_time";
/// Last completed lap time reported by the game, s (0 if none)
pub const LAST_LAP_TIME: &str = "last_lap_time";
/// World position, m (y is up)
pub const POS_X: &str = "pos_x";
pub const POS_Y: &str = "pos_y";
pub const POS_Z: &str = "pos_z";
/// 1 when in pit lane / pit box
pub const IN_PIT: &str = "in_pit";
/// Number of wheels outside track limits
pub const TYRES_OUT: &str = "tyres_out";
/// litres
pub const FUEL: &str = "fuel";

pub const WHEELS: [&str; 4] = ["fl", "fr", "rl", "rr"];
