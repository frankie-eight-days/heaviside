# Heaviside — handoff notes

Working notes for the next agent picking up this project. Read once, then act on (or delete the stale parts). Things that belong in ADRs eventually live here first.

## Current state (as of c099310, pushed to origin/main)

All milestones M1–M7c are shipped. Branch is clean.

What's live in the UI:
- **6 antenna scenes** (Hertzian, λ/2 dipole, Yagi-Uda, corner reflector, parabolic, broadside array) + **TX/RX link demo**.
- **3 PCB scenes** (microstrip, stripline, differential pair), all labeled "2D parallel-plate analog" to be honest about the polarization limitation.
- Every scene ships with **probes pre-placed** at positions that highlight its key physics — no setup required.
- Engine: probes + GPU ring-buffer history + async readback via mapAsync. FFT-based spectrum analyzer with Linear/dB toggle. Per-probe peak/RMS/Δφ metrics. VSWR + |Γ| readout. Probe-line click-drag.
- Source modulation: sine / square / triangle / sawtooth / AM / FM, all JS-side in `evaluateSource()`.

ADRs 0001–0008 are written and committed. The roadmap in CLAUDE.md is up to date through M7c.

## Roadmap (user decided in current conversation)

In order:

1. **M7d — S-parameter de-embedding (next)**. Reference-run-based separation of incident/reflected waves at a probe; FFT both to get S11(f). The highest-ROI measurement feature — lets users measure ANY structure they paint, regardless of polarization. ~2 sessions. Should get its own ADR (0009) before coding.

2. **M8 — 2D TEz polarization variant**. Parallel shader set with `Ex, Ey, Hz` instead of current TMz's `Ez, Hx, Hy`. Unlocks proper microstrip / stripline / CPW / PIFA pedagogy because the E-field can point vertically between trace and ground (which TMz can't represent). Trade-off: parallel engines = maintenance burden. ~2-3 sessions. ADR-worthy.

3. **M9 — Full 3D FDTD**. The "real" simulator. 6 field components, volume rendering, 3D camera, raycast probe placement. Real polarization, real antenna patterns in dBi, real near-to-far-field transforms. ~5-10 sessions, huge scope. Eventual destination.

## Critical gotchas (won't be obvious from reading code alone)

1. **8-storage-buffers-per-stage WebGPU limit** (Safari enforces). The E shader is currently at exactly 8. Adding more silently fails pipeline creation on Safari with no console error — the result is a black canvas while non-compute paths look fine. See ADR 0003. New compute work should live in its own pipeline (envelope, source-apply, probe-sample all do this) or negotiate a higher limit at device creation.

2. **PCB scenes are 2D-TMz parallel-plate analogs, NOT textbook microstrip TEM**. The TMz polarization with `Ez` out-of-page can't carry a TEM mode that points vertically between trace and ground. What our PCB scenes actually show is the parallel-plate TM₁ mode (sinusoidal `Ez` across the gap). The descriptions are honest about this. M8 (TEz) would fix it.

3. **Probe readback is async via `mapAsync`**. Single staging buffer, state machine `'idle' | 'in-flight'`. The JS-side `probeHistoryShadow` (Float32Array) is the read interface; UI components rAF-loop it. If the staging buffer is "mapped" and you try to write to it, WebGPU throws — that's why we gate on `probeReadbackState`.

4. **Uniform struct is 48 bytes**, layout commented in `fdtd.ts`. All shaders (e, h, source-apply, envelope, probe-sample, field-render) must keep the struct in lockstep. Adding a field means updating six WGSL files + the TS layout + indices used by setters.

5. **HMR doesn't rebuild WebGPU pipelines**. When `.wgsl` or `fdtd.ts` changes, Vite reloads JS but the engine inside GPUCanvas keeps its old compiled pipelines until the component unmounts. After shader/struct changes, the user has to hard-reload (⌘⇧R). The first time we hit this was a confusing black-canvas debug session — flag it preemptively when you ship shader changes.

6. **Source values are computed JS-side**. The `source-apply.wgsl` compute pass just writes pre-computed values into Ez at source cells. All waveform / modulation logic is in `evaluateSource()` in `fdtd.ts`. Adding new waveforms = just adding a switch case in JS. No shader work.

7. **MAX_SOURCES = 128, MAX_PROBES = 32**. Bumping requires no shader changes (sources buffer is allocated up to MAX), but the history buffer scales linearly with MAX_PROBES.

## User communication style

- Frank Walsh, OSU MEng student. Strong RF/EE background — comfortable with PCB design, transmission lines, antenna theory, VSWR, GPIO/microstrip intuition. Catches sim limitations and asks great physics questions.
- Enthusiastic when things land ("amazing", "freaking cool"). Praise tells you you're on the right track; vague "hmm" means dig deeper.
- **Wants explanations before code for architectural decisions.** When in doubt about a design fork, ask. Specifically: "don't add anything yet, just tell me about it" is a real signal — respect it.
- **Approves commits and pushes explicitly.** "commit and push please" or similar. Never push without an explicit ask. Commits without ask are fine if they're a clean checkpoint.
- **Likes incremental commits** — every milestone gets its own commit + push, clear message.
- OK with bigger bundles when they're tightly coupled (M6 was 25 files in one commit, M7a was 15). Don't artificially split.

## Open M7d design questions

Talk through these BEFORE coding M7d:

1. **How does the user trigger a reference run?** Auto on scene load? Manual "Calibrate" button? Auto when first probe is dropped? My lean: manual button — explicit, no surprise compute cost.

2. **Where is the "DUT region" marked?** A bounding box painted with a special tool? "Everything past x = X" for transmission-line scenes? Probably both, depending on scene.

3. **Time gating vs. reference subtraction.** Both work for separating incident/reflected. Reference subtraction is more reliable and matches lab practice (calibration kits). Time gating only works if there's enough propagation delay between source and DUT for the incident pulse to clear before the reflection arrives.

4. **S11 display in panel.** Magnitude only? Magnitude + phase plot? Smith chart eventually (RF-engineering gold standard)? Polar plot for radiation pattern (M9 territory)?

5. **Pulse vs CW for the measurement.** Pulse gives broadband S11 in one run (matches real VNA). CW gives a single point at the source frequency. Default to pulse — much more useful.

## Files where things live

```
src/gpu/fdtd.ts                  Engine factory, pipelines, state, step loop, all APIs.
src/gpu/init.ts                  WebGPU adapter init.
src/shaders/
  fdtd-e.wgsl                    E-update with per-cell ε/σ, PEC flag.
  fdtd-h.wgsl                    H-update.
  source-apply.wgsl              Per-step writes of source values into Ez.
  envelope.wgsl                  Peak-with-decay EMA of |Ez| for Magnitude view.
  probe-sample.wgsl              Per-step probe sampling into history ring.
  field-render.wgsl              Render: Ez or Magnitude view + source/probe markers.
src/scenes/
  types.ts, helpers.ts
  antennas/                      6 scenes + tx-rx-link.ts.
  pcb/                           3 scenes (all labeled 2D analog).
  index.ts                       ALL_SCENES array.
src/components/
  GPUCanvas.tsx                  React wrapper; pointer events, overlay canvas for drag preview.
  Toolbar.tsx                    Brush palette, sliders, source controls, view toggle.
  ExamplesSidebar.tsx            Scene list (left).
  MeasurementPanel.tsx           Right panel: probe list, VSWR, time-series + FFT plots.
src/lib/fft.ts                   Radix-2 FFT.
src/App.tsx, App.css, main.tsx, index.css
docs/decisions/                  ADRs 0001–0008.
docs/handoff.md                  This file.
```

## Recent conversation context

The conversation that ended with this handoff covered the polarization limitation in depth. User now understands:
- 2D TMz can't model microstrip TEM (would need TEz or 3D).
- The "source" in our sim represents a voltage driver (like a GPIO).
- Receive antennas are just passive PEC structures probed at the feed gap.
- VSWR for any painted structure is measured via a feed line with probes (slotted-line style).
- The TX/RX link scene now demos all of this (directivity, path loss, RX V_oc) — load it to refresh on what the user has seen.

User has read the descriptions of all three options (TEz / 3D / M7d) and chosen the order M7d → M8 (TEz) → M9 (3D).
