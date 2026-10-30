# StatsMeister

Open-source telemetry recorder and analyser for sim racing — a free, MoTeC-style
tool for Assetto Corsa, ACC, Automobilista 2, iRacing, Le Mans Ultimate and more.

Record every lap at the game's native rate, overlay laps on distance, see exactly
where time is gained or lost, export the data, and (soon) ask a local or cloud
LLM for coaching based on your own telemetry.

## Status

Early development. What works today:

| Area | State |
|---|---|
| Assetto Corsa / ACC (shared memory) | ✅ physics + graphics + static pages, ~333 Hz polling |
| Assetto Corsa replays (`.acreplay`, v16) import | ✅ ~33 Hz: inputs, speed, rpm, gear, g-forces, wheel speeds/loads/slip, position |
| Demo source (synthetic car on a fake circuit) | ✅ develop & test without a game |
| Recording, lap detection, official lap times, pit/cut flags | ✅ |
| Storage: Parquet (zstd) + JSON metadata | ✅ |
| Lap comparison on distance, delta, track map, cursor readout, lap stats | ✅ |
| Per-corner breakdown: time lost, min speed, braking and throttle points | ✅ click a corner to zoom |
| CSV export (session or lap) | ✅ |
| iRacing, AMS2, LMU / rFactor 2, MoTeC `.ld` export, AI coach | 🗺️ see [docs/ROADMAP.md](docs/ROADMAP.md) |

## Layout

```
crates/
  sm-core       data model: channels, frames, TelemetrySource trait
  sm-sources    game adapters (ac/ = AC + ACC shared memory, demo.rs, auto.rs)
  sm-storage    session folders: telemetry.parquet + meta.json, CSV export
  sm-recorder   recording loop + lap tracker
  sm-analysis   lap alignment, comparison, per-lap stats
  sm-cli        `statsmeister` command line tool
app/
  src/          UI (TypeScript, Vite, uPlot)
  src-tauri/    Tauri 2 desktop shell exposing the crates as commands
```

All channels are stored as `f32` columns. Well-known channels use common names
and units (`speed` km/h, `throttle` 0..1, `lap_dist_pct` 0..1, …, see
`crates/sm-core/src/ch.rs`), so analysis and UI work the same for every game;
game-specific extras are kept too.

Sessions are saved in `%APPDATA%\StatsMeister\data\sessions\<id>\`
(override with the `STATSMEISTER_DATA` environment variable). The Parquet files
open directly in DuckDB, pandas, Polars, etc.

## Building

Requirements: Rust (stable, MSVC on Windows), Node.js 20+, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2 is
preinstalled on Windows 10/11).

```bash
# desktop app (dev mode with hot reload)
cd app
npm install
npm run tauri dev

# release build / installer
npm run tauri build

# CLI + tests
cargo test
cargo run -p sm-cli -- --help
```

## CLI

```bash
statsmeister record                    # auto-detect a running game, Ctrl+C to stop
statsmeister record --source demo --fast --laps 5
statsmeister list
statsmeister laps latest
statsmeister import "sokol hotlap.acreplay"   # also: Import button or drag & drop in the app
statsmeister compare latest:best latest:3     # per-corner table
statsmeister export latest --lap 3 -o lap3.csv
```

## In-game setup

- **Assetto Corsa / ACC** — nothing to configure; shared memory is always on.
- **AC replays** — saved in `Documents\Assetto Corsa\replay`. Replays hold
  less than live recording (no tyre temperatures/pressures, fuel, ABS/TC or
  track-limit info, and only the replay sample rate), so record live for
  practice sessions and use import for older laps. Set *Replay quality* to the
  maximum in AC's settings for the best resolution. Test a real file with
  `STATSMEISTER_TEST_REPLAY=path\to\file.acreplay cargo test -p sm-sources`.

## Adding a game

Implement `sm_core::TelemetrySource` in a new module under `crates/sm-sources`,
map the game's values onto the standard channel names, add it to `SourceKind`
and to `KNOWN_GAMES` for auto-detection. The recorder, storage, analysis and UI
need no changes.

## License

MIT — see [LICENSE](LICENSE).
