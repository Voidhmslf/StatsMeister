# Roadmap

## 1. More games

| Game | Interface | Notes |
|---|---|---|
| iRacing | irsdk shared memory `Local\IRSDKMemMapFileName` | 60 Hz, variable header describes every channel (map them dynamically); `_ST` arrays give 360 Hz for some channels. Also import `.ibt` files — same format on disk, free history. |
| Automobilista 2 | Project CARS 2 shared memory `$pcars2$` | User must enable *Shared Memory: Project CARS 2* in game options. |
| rFactor 2 / Le Mans Ultimate | rF2 Shared Memory Map Plugin (`$rFactor2SMMP_Telemetry$` …) | Check whether current LMU builds ship a native shared memory API first. |
| RaceRoom | `$R3E` shared memory | |
| F1 series, Forza, BeamNG | UDP | One UDP listener with per-game packet parsers. |

Reference implementation for many structs: CrewChief V4 (GPL-3.0 — read for
understanding, don't copy code into this MIT project). Prefer official SDK
headers.

## 2. Analysis

- Corner detection (curvature from position or steering + speed minima), named
  per track via community JSON files.
- Per-corner metrics: braking point, peak brake pressure, trail braking,
  minimum speed, throttle pickup point, exit speed, time lost/gained.
- Sector times, theoretical best lap, consistency (std-dev per corner).
- Tyre/brake temperature and pressure windows per stint.
- Math channels (user formulas), histograms, XY scatter (e.g. g-g diagram).
- DuckDB over all Parquet files for cross-session queries.

## 3. Export

- MoTeC i2 `.ld` (+ `.ldx`) so data opens in the free MoTeC i2 Pro viewer.
- Parquet / JSON lap summary, HTML/PDF session report.

## 4. AI coach

Never send raw samples to the model. Instead:

1. `sm-analysis` produces a compact JSON per lap / per corner (metrics above,
   deltas vs. reference lap).
2. The model gets that JSON plus tools it can call:
   `compare_corner(a, b, corner)`, `channel_stats(lap, channel, from_m, to_m)`,
   `query_sessions(sql)`.
3. Providers behind one trait:
   - OpenAI-compatible endpoint — covers Ollama, LM Studio, llama.cpp server,
     OpenRouter, OpenAI;
   - native Anthropic and Gemini clients.
   API keys stored in the OS keychain, never in config files.
4. UI: chat panel next to the charts; answers can reference distances, and
   clicking them moves the cursor there.

## 5. App

- Live dashboard while recording (current delta to best, tyre temps).
- Lap library across sessions grouped by track + car; reference laps.
- Settings: data folder, units, poll rate, idle timeout.
- Crash-safe recording (Parquet footer is written on stop; add periodic
  segment files so an interrupted session is still readable).
- Installer + auto-update, CI on GitHub Actions.
