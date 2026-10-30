<div align="center">

# StatsMeister

**Open-source telemetry recorder and lap analyser for sim racing.**

Record your laps, overlay them on distance and see exactly which corner costs you time — and why.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-2024-orange.svg)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Status](https://img.shields.io/badge/status-early%20development-yellow.svg)

</div>

![StatsMeister comparing two laps of a Porsche 992 GT3 RS](docs/images/screenshot.png)

## Why

Tools like MoTeC i2 are powerful but built for engineers. StatsMeister aims at the
sim racer who wants to get a bit faster every day: open a session, and the app
already tells you where the time went — late braking that didn't pay off, a slow
apex, throttle applied too late.

## Features

- **Live recording** from Assetto Corsa and Assetto Corsa Competizione via shared memory
  (~333 Hz, ~70 channels: inputs, speed, g-forces, tyre temps/pressures/wear, brake temps,
  suspension, wheel slip and loads, position).
- **Assetto Corsa replay import** — drop an `.acreplay` file onto the window to analyse
  laps you drove before installing StatsMeister.
- **Automatic lap detection** with the game's official lap times; out laps, pit laps and
  track-limit cuts are flagged.
- **Lap comparison on distance** — any two laps, even from different sessions, aligned by
  track position, with a running time delta.
- **Corner-by-corner breakdown** — corners are detected automatically; for each one you get
  time gained/lost, minimum speed, braking point and full-throttle point. Click a corner to
  zoom every chart to it.
- **Track map** coloured by where the compared lap gains (green) or loses (red) time.
- **Synced charts** (speed, throttle, brake, steering, gear, RPM, lateral G) with a shared
  cursor and zoom, plus a value readout and per-lap statistics.
- **Open data** — sessions are stored as Parquet + JSON and can be exported to CSV.
- **Command line tool** for recording, importing, comparing and exporting without the UI.
- **Demo source** that simulates a car on a made-up circuit, so you can try everything
  without a game.

## Supported games

| Game | Live recording | File import |
|---|---|---|
| Assetto Corsa | ✅ shared memory | ✅ `.acreplay` (format v16) |
| Assetto Corsa Competizione | ✅ shared memory | — |
| iRacing | planned | planned (`.ibt`) |
| Automobilista 2 | planned | — |
| Le Mans Ultimate / rFactor 2 | planned | — |

Replays contain less data than live recording: no tyre temperatures or pressures, fuel,
ABS/TC activity or track-limit information, and only the replay's sample rate (about 33 Hz
at default quality). Record live for practice; use import for older laps.

## Getting started

### Requirements

- Windows 10/11 (WebView2 is preinstalled)
- [Rust](https://rustup.rs) stable (MSVC toolchain) and Visual Studio Build Tools
- [Node.js](https://nodejs.org) 20+

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) if a build fails.

### Run the app

```bash
git clone https://github.com/Voidhmslf/StatsMeister.git
cd StatsMeister/app
npm install
npm run tauri dev
```

Build an installer with `npm run tauri build` (output in `target/release/bundle`).

### Use it

1. **Record:** pick *Auto-detect* (or a game), press **Record**, then drive. Each stint on
   track becomes a session; laps appear as you complete them.
2. **Or import:** press **Import** or drag an `.acreplay` file onto the window. AC saves
   replays in `Documents\Assetto Corsa\replay`; set *Replay quality* to the maximum in AC's
   settings for the best resolution.
3. **Analyse:** the best lap is selected as **A** and a recent representative lap as **B**.
   Read the corner table top to bottom, click the corners where you lose the most, and
   compare braking points, minimum speed and throttle application in the charts.

No game at hand? Choose **Demo** and press **Record**.

## Command line

```bash
cargo run -p sm-cli -- --help
```

```bash
statsmeister record                          # auto-detect a running game, Ctrl+C to stop
statsmeister record --source demo --fast --laps 5
statsmeister import "sokol hotlap.acreplay"
statsmeister list
statsmeister laps latest
statsmeister compare latest:best latest:3    # per-corner breakdown
statsmeister export latest --lap 3 -o lap3.csv
```

Example `compare` output:

```text
A = lap 4 1:50.810   B = lap 5 1:52.178   track ≈ 4376 m
Corner   apex  B vs A   min speed A/B    brake point B vs A   full throttle B vs A
T1      364 m  +0.301   100.5 /  98.0       7 m later            6 m later
T4     1243 m  +0.347    77.2 /  69.6    same                    6 m earlier
T9     3719 m  -0.161    75.6 /  82.9    same                    3 m earlier
...
```

## Data

Sessions live in `%APPDATA%\StatsMeister\data\sessions\<session id>\` (override with the
`STATSMEISTER_DATA` environment variable):

```text
meta.json           session info, channel list, laps with times and flags
telemetry.parquet   column "t" (seconds) + one float column per channel, zstd-compressed
```

The Parquet files open directly in DuckDB, pandas, Polars or any other Parquet reader.
Channels with a common meaning use the same name and unit for every game (`speed` in km/h,
`throttle` 0..1, `lap_dist_pct` 0..1, …; see [`ch.rs`](crates/sm-core/src/ch.rs)), and
game-specific extras are kept alongside.

## Project layout

```text
crates/
  sm-core       data model: channels, frames, the TelemetrySource trait
  sm-sources    game adapters: ac/ (AC + ACC shared memory, .acreplay import), demo, auto-detect
  sm-storage    session folders (Parquet + JSON), CSV export
  sm-recorder   recording loop and lap tracker
  sm-analysis   lap alignment, comparison, corner detection, lap statistics
  sm-cli        the `statsmeister` command line tool
app/
  src/          UI: TypeScript, Vite, uPlot
  src-tauri/    Tauri 2 shell exposing the crates as commands
docs/
  ROADMAP.md    what's next
```

## Development

```bash
cargo test --workspace
cargo clippy --workspace --all-targets
cargo fmt --all
```

To run the replay parser against a real file:

```bash
STATSMEISTER_TEST_REPLAY="path/to/file.acreplay" cargo test -p sm-sources
```

### Adding a game

Implement `sm_core::TelemetrySource` in a new module under `crates/sm-sources`, map the
game's values onto the standard channel names, and register it in `SourceKind` and
`KNOWN_GAMES`. Recording, storage, analysis and the UI need no changes.

## Roadmap

Highlights from [docs/ROADMAP.md](docs/ROADMAP.md):

- iRacing (live + `.ibt` import), Automobilista 2, Le Mans Ultimate / rFactor 2
- theoretical best lap and per-corner consistency across all laps
- progress tracking per track and car over days
- MoTeC i2 `.ld` export
- AI coach: local (Ollama, LM Studio) or cloud LLMs explaining the corner breakdown

## Contributing

Issues and pull requests are welcome. Please run the tests, clippy and rustfmt before
opening a PR. Reverse-engineered formats (like `.acreplay`) are documented in the module
that parses them; corrections from real-world files are especially valuable.

## License

[MIT](LICENSE)
