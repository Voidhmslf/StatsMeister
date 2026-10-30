use crate::SessionData;
use anyhow::{Result, bail};
use std::io::Write;

/// Writes frames `range` (or the whole session) as CSV with a header row
/// `t,<channel> [unit],...`. Channels keep their recorded order.
pub fn write_csv(
    data: &SessionData,
    range: Option<std::ops::Range<usize>>,
    out: &mut impl Write,
) -> Result<()> {
    let range = range.unwrap_or(0..data.t.len());
    if range.end > data.t.len() {
        bail!("frame range {range:?} is out of bounds");
    }
    let cols: Vec<(&str, &str, &[f32])> = data
        .meta
        .channels
        .iter()
        .filter_map(|c| Some((c.name.as_str(), c.unit.as_str(), data.channel(&c.name)?)))
        .collect();

    write!(out, "t [s]")?;
    for (name, unit, _) in &cols {
        if unit.is_empty() {
            write!(out, ",{name}")?;
        } else {
            write!(out, ",{name} [{unit}]")?;
        }
    }
    writeln!(out)?;

    let t0 = data.t.get(range.start).copied().unwrap_or(0.0);
    for i in range {
        write!(out, "{:.4}", data.t[i] - t0)?;
        for (_, _, values) in &cols {
            write!(out, ",{}", values[i])?;
        }
        writeln!(out)?;
    }
    Ok(())
}
