use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use sm_recorder::{RecorderEvent, RecorderOptions};
use sm_sources::{SourceKind, SourceOptions};
use sm_storage::SessionMeta;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Parser)]
#[command(
    name = "statsmeister",
    version,
    about = "Sim racing telemetry recorder"
)]
struct Cli {
    /// Data folder (default: STATSMEISTER_DATA or the per-user app data folder)
    #[arg(long, global = true)]
    data: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Record telemetry until Ctrl+C
    Record {
        /// auto | ac | acc | demo
        #[arg(long, default_value = "auto")]
        source: String,
        /// Stop after this many completed laps
        #[arg(long)]
        laps: Option<u32>,
        /// Demo source: generate data as fast as possible
        #[arg(long)]
        fast: bool,
    },
    /// List recorded sessions
    List,
    /// Show laps of a session ("latest" for the most recent)
    Laps { session: String },
    /// Compare two laps: SESSION:LAP (LAP may be "best")
    Compare { reference: String, other: String },
    /// Import an Assetto Corsa replay (.acreplay) as a session
    Import { file: PathBuf },
    /// Export a session or a single lap to CSV
    Export {
        session: String,
        #[arg(long)]
        lap: Option<u32>,
        #[arg(long, short)]
        out: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let root = cli.data.unwrap_or_else(sm_storage::default_data_dir);
    match cli.cmd {
        Cmd::Record { source, laps, fast } => record(root, &source, laps, fast),
        Cmd::List => list(&root),
        Cmd::Laps { session } => laps(&root, &session),
        Cmd::Compare { reference, other } => compare(&root, &reference, &other),
        Cmd::Import { file } => import(&root, &file),
        Cmd::Export { session, lap, out } => export(&root, &session, lap, &out),
    }
}

fn record(root: PathBuf, source: &str, max_laps: Option<u32>, fast: bool) -> Result<()> {
    let kind = SourceKind::parse(source).with_context(|| format!("unknown source '{source}'"))?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let stop = stop.clone();
        ctrlc::set_handler(move || stop.store(true, Ordering::Relaxed))?;
    }
    println!("Recording to {} (Ctrl+C to stop)", root.display());
    let opts = RecorderOptions {
        data_dir: root,
        ..Default::default()
    };
    let src = sm_sources::open(kind, &SourceOptions { fast });
    let mut completed = 0;
    let stop_cb = stop.clone();
    sm_recorder::run(src, &opts, &stop, move |e| match e {
        RecorderEvent::Waiting => println!("Waiting for game..."),
        RecorderEvent::SessionStarted { id, info } => {
            println!(
                "Session {id}: {} / {} / {}",
                info.game, info.track, info.car
            )
        }
        RecorderEvent::LapCompleted { lap, .. } => {
            println!(
                "  lap {:>3}  {}{}",
                lap.number,
                fmt_lap(lap.time_s),
                lap_flags(&lap)
            );
            if lap.complete {
                completed += 1;
            }
            if max_laps.is_some_and(|n| completed >= n) {
                stop_cb.store(true, Ordering::Relaxed);
            }
        }
        RecorderEvent::SessionSaved {
            id,
            laps,
            duration_s,
        } => println!("Saved {id}: {laps} laps, {duration_s:.0} s"),
        RecorderEvent::SessionDiscarded { id } => println!("Discarded short session {id}"),
        RecorderEvent::Error { message } => eprintln!("error: {message}"),
    })
}

fn list(root: &Path) -> Result<()> {
    let sessions = sm_storage::list_sessions(root)?;
    if sessions.is_empty() {
        println!("No sessions in {}", root.display());
    }
    for s in sessions {
        let best = s
            .best_lap()
            .map(|l| fmt_lap(l.time_s))
            .unwrap_or("-".into());
        println!(
            "{:<45} {:<28} {:<24} {:>3} laps  best {}",
            s.id,
            s.info.track,
            s.info.car,
            s.laps.iter().filter(|l| l.complete).count(),
            best
        );
    }
    Ok(())
}

fn resolve_session(root: &Path, id: &str) -> Result<SessionMeta> {
    if id == "latest" {
        return sm_storage::list_sessions(root)?
            .into_iter()
            .next()
            .context("no sessions recorded yet");
    }
    sm_storage::load_meta(root, id)
}

fn laps(root: &Path, session: &str) -> Result<()> {
    let data = sm_storage::load_session(root, &resolve_session(root, session)?.id)?;
    let best = data.meta.best_lap().map(|l| l.number);
    println!(
        "{} — {} / {}",
        data.meta.id, data.meta.info.track, data.meta.info.car
    );
    for lap in &data.meta.laps {
        let trace = sm_analysis::LapTrace::new(&data, lap);
        let st = sm_analysis::stats::lap_stats(&trace);
        println!(
            "{} lap {:>3}  {}  vmax {:>5.1}  full thr {:>4.1}%  brake {:>4.1}%{}",
            if Some(lap.number) == best { "*" } else { " " },
            lap.number,
            fmt_lap(lap.time_s),
            st.max_speed_kmh,
            st.full_throttle_pct,
            st.braking_pct,
            lap_flags(lap)
        );
    }
    Ok(())
}

fn parse_lap_ref(root: &Path, s: &str) -> Result<(sm_storage::SessionData, u32)> {
    let (session, lap) = s.rsplit_once(':').context("expected SESSION:LAP")?;
    let meta = resolve_session(root, session)?;
    let lap = if lap == "best" {
        meta.best_lap().context("session has no valid laps")?.number
    } else {
        lap.parse()?
    };
    if meta.lap(lap).is_none() {
        bail!("session {} has no lap {lap}", meta.id);
    }
    Ok((sm_storage::load_session(root, &meta.id)?, lap))
}

fn compare(root: &Path, a: &str, b: &str) -> Result<()> {
    let (da, la) = parse_lap_ref(root, a)?;
    let (db, lb) = parse_lap_ref(root, b)?;
    let ta = sm_analysis::LapTrace::new(&da, da.meta.lap(la).expect("checked"));
    let tb = sm_analysis::LapTrace::new(&db, db.meta.lap(lb).expect("checked"));
    use sm_core::ch;
    let cmp = sm_analysis::compare_laps(&ta, Some(&tb), &[ch::SPEED, ch::BRAKE, ch::THROTTLE], 1.0);
    println!(
        "A = lap {la} {}   B = lap {lb} {}   track ≈ {:.0} m",
        fmt_lap(cmp.reference.time_s),
        fmt_lap(cmp.compare.as_ref().map_or(0.0, |c| c.time_s)),
        cmp.track_length_m
    );
    println!("Corner   apex  B vs A   min speed A/B    brake point B vs A   full throttle B vs A");
    let opt = |v: Option<f32>| v.map_or("    -".to_string(), |v| format!("{v:5.1}"));
    let diff = |p: [Option<f32>; 2], later: &str, earlier: &str| match p {
        [Some(a), Some(b)] if (b - a).abs() >= 1.0 => {
            format!(
                "{:>4.0} m {}",
                (b - a).abs(),
                if b > a { later } else { earlier }
            )
        }
        [Some(_), Some(_)] => "same".to_string(),
        _ => "-".to_string(),
    };
    for c in &cmp.corners {
        println!(
            "T{:<4} {:>5.0} m  {:>+6.3}   {} / {}    {:<20} {}",
            c.number,
            c.apex_m,
            c.delta_s.unwrap_or(0.0),
            opt(c.min_speed[0]),
            opt(c.min_speed[1]),
            diff(c.brake_m, "later", "earlier"),
            diff(c.throttle_m, "later", "earlier"),
        );
    }
    Ok(())
}

fn import(root: &Path, file: &Path) -> Result<()> {
    let bytes = std::fs::read(file).with_context(|| format!("reading {}", file.display()))?;
    let replay = sm_sources::ac::replay::parse(&bytes)?;
    if replay.car_count > 1 {
        println!(
            "Replay has {} cars; importing the first one.",
            replay.car_count
        );
    }
    let meta = sm_recorder::import_frames(
        root,
        &replay.info,
        "Assetto Corsa replay",
        &replay.channels,
        &replay.frames,
    )?;
    println!(
        "Imported {}: {} / {} / {}, {} frames at {:.0} Hz",
        meta.id,
        meta.info.track,
        meta.info.car,
        meta.info.driver,
        meta.frames,
        1.0 / replay.sample_interval_s
    );
    laps(root, &meta.id)
}

fn export(root: &Path, session: &str, lap: Option<u32>, out: &Path) -> Result<()> {
    let data = sm_storage::load_session(root, &resolve_session(root, session)?.id)?;
    let range = match lap {
        Some(n) => {
            let l = data.meta.lap(n).with_context(|| format!("no lap {n}"))?;
            Some(l.start..l.end)
        }
        None => None,
    };
    let mut w = std::io::BufWriter::new(std::fs::File::create(out)?);
    sm_storage::export::write_csv(&data, range, &mut w)?;
    println!("Wrote {}", out.display());
    Ok(())
}

fn fmt_lap(s: f64) -> String {
    let m = (s / 60.0).floor();
    format!("{}:{:06.3}", m as u32, s - m * 60.0)
}

fn lap_flags(lap: &sm_storage::LapMeta) -> String {
    let mut f = Vec::new();
    if !lap.complete {
        f.push("partial");
    }
    if lap.in_pit {
        f.push("pit");
    }
    if lap.cut {
        f.push("cut");
    }
    if f.is_empty() {
        String::new()
    } else {
        format!("  ({})", f.join(", "))
    }
}
