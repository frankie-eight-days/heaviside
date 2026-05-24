# Heaviside — handoff notes

Working notes for the next agent picking up this project. Read once, then act on (or delete the stale parts). Things that belong in ADRs eventually live here first.

## Current state (M8 shipped)

All milestones M1–M7c plus M8 are shipped. Branch is clean. ADRs 0001–0009 are written and committed.

What's live in the UI:
- **6 antenna scenes** (Hertzian, λ/2 dipole, Yagi-Uda, corner reflector, parabolic, broadside array) + **TX/RX link demo** — all TMz.
- **3 PCB scenes** (microstrip, stripline, differential pair) — all TEz, showing the textbook quasi-TEM mode (vertical Ey, circulating Hz).
- **Header polarization toggle**: `[TMz] [TEz] [3D (soon)]`. Loading a scene auto-switches; manual toggle preserves materials and clears fields.
- **Source brush** gains an Ex/Ey selector when the active polarization is TEz.
- Engine: probes + GPU ring-buffer history + async readback. FFT spectrum analyzer with Linear/dB toggle. Per-probe peak/RMS/Δφ metrics. VSWR + |Γ| readout. Probe-line click-drag.
- Source modulation: sine / square / triangle / sawtooth / AM / FM.

## Roadmap

In order:

1. **M7d — S-parameter de-embedding (next)**. Reference-run-based separation of incident/reflected. Highest-ROI measurement feature — works for any structure the user paints regardless of polarization. ~2 sessions. Should write ADR 0010 first. Five design questions captured in the previous handoff still stand (reference-run trigger, DUT region marking, time gating vs. reference subtraction, S11 display, pulse vs CW).

2. **M9 — Full 3D FDTD**. The "real" simulator. 6 field components, volume rendering, 3D camera, raycast probe placement. Real polarization, real antenna patterns in dBi, real near-to-far-field transforms. ~5–10 sessions, huge scope.

## Critical gotchas (won't be obvious from reading code alone)

1. **8-storage-buffers-per-stage WebGPU limit** (Safari enforces). Both engine E shaders are at exactly 8. Adding more silently fails pipeline creation on Safari with no console error → black canvas. See ADR 0003. New compute work should live in its own pipeline (envelope, source-apply, probe-sample all do this) or negotiate a higher limit at device creation.

2. **HMR doesn't rebuild WebGPU pipelines.** When `.wgsl` or `fdtd.ts` / `fdtd-tez.ts` changes, Vite reloads JS but the engine inside GPUCanvas keeps its old compiled pipelines until the component unmounts. After shader/struct changes the user has to hard-reload (⌘⇧R). Flag preemptively when shipping shader changes.

3. **Probe readback is async via `mapAsync`.** Single staging buffer, state machine `'idle' | 'in-flight'`. JS-side `probeHistoryShadow` (Float32Array) is the read interface; UI components rAF-loop it. If the staging buffer is "mapped" and you try to write to it, WebGPU throws — that's why we gate on `probeReadbackState`. Each engine owns its own staging.

4. **Uniform struct is 48 bytes**, layout commented in `fdtd.ts`. All shaders (both engines' e, h, source-apply, envelope, probe-sample, field-render — 12 files total) must keep the struct in lockstep. Adding a field means updating 12 WGSL files + the TS layout + indices used by setters.

5. **Source values are computed JS-side.** The `source-apply{,-tez}.wgsl` compute pass just writes pre-computed values into the right field cell. All waveform / modulation logic is in `evaluateSource()` in `fdtd.ts` and (duplicated for now) `fdtd-tez.ts`. Adding new waveforms = switch case in both engines. Worth deduping eventually.

6. **Polarization swap mechanics.** Materials preserved, fields cleared, probes preserved (positions only — history wiped), sources kept by GPUCanvas only for scene-driven swaps; on manual toggle they reset to the engine's default single-source-at-center. See `swapEngineTo` in `GPUCanvas.tsx` and ADR 0009.

7. **TEz Source struct** has a 4th u32 field for source polarization (0/1/2 = z/x/y). TMz's struct ignores the 4th field (just `_pad`). When updating either shader's `Source`, update both.

8. **MAX_SOURCES = 128, MAX_PROBES = 32**. Bumping requires no shader changes; history buffer scales linearly with MAX_PROBES.

## User communication style

- Frank Walsh, OSU MEng student. Strong RF/EE background — comfortable with PCB design, transmission lines, antenna theory, VSWR, GPIO/microstrip intuition. Catches sim limitations and asks great physics questions.
- Enthusiastic when things land ("amazing", "freaking cool"). Praise tells you you're on the right track; vague "hmm" means dig deeper.
- **Wants explanations before code for architectural decisions.** "Don't add anything yet, just tell me about it" is a real signal — respect it.
- **Approves commits and pushes explicitly.** "commit and push please" or similar. Never push without an explicit ask.
- **Likes incremental commits** — every milestone gets its own commit + push, clear message.
- OK with bigger bundles when they're tightly coupled (M6: 25 files, M7a: 15, M8: ~22).

## Open M7d design questions (carried forward from previous handoff)

Talk through these BEFORE coding M7d:

1. **How does the user trigger a reference run?** Auto on scene load? Manual "Calibrate" button? Lean: manual button — explicit, no surprise compute cost.

2. **Where is the "DUT region" marked?** Bounding box painted with a special tool? "Everything past x = X" for transmission-line scenes? Probably both.

3. **Time gating vs. reference subtraction.** Both work. Reference subtraction matches lab calibration kits and is more reliable.

4. **S11 display in panel.** Magnitude only? Mag + phase? Smith chart eventually?

5. **Pulse vs CW.** Pulse gives broadband S11 in one run (matches VNA). Default to pulse.

## Files where things live

```
src/gpu/
  init.ts                          WebGPU adapter init.
  fdtd.ts                          TMz engine factory + shared types (Polarization, SourceSpec, FDTDEngine).
  fdtd-tez.ts                      TEz engine factory — same FDTDEngine surface.
  engine.ts                        Polarization-aware createEngine() used by GPUCanvas.
src/shaders/
  fdtd-{e,h}.wgsl                  TMz Yee updates.
  fdtd-{e,h}-tez.wgsl              TEz Yee updates (Hz split for PML).
  source-apply{,-tez}.wgsl         Per-step writes of source values into the principal field(s).
  envelope{,-tez}.wgsl             Peak-with-decay EMA of |Ez| / |E|.
  probe-sample{,-tez}.wgsl         Per-step probe sampling — Ez in TMz, Hz in TEz.
  field-render{,-tez}.wgsl         Renderers: signed scalar or magnitude + source/probe markers.
src/scenes/
  types.ts, helpers.ts             Scene interface + paint/port helpers. Each scene declares its
                                   preferred polarization via a top-level `polarization` field.
  antennas/                        7 TMz scenes.
  pcb/                             3 TEz scenes (no more "2D analog" disclaimers).
  index.ts                         ALL_SCENES array.
src/components/
  GPUCanvas.tsx                    React wrapper; engine lifecycle; polarization swap via swapEngineTo.
  Toolbar.tsx                      Brush palette, sliders, source controls, view toggle. Relabels
                                   Ez→Hz based on active polarization; Ex/Ey radio in TEz source mode.
  ExamplesSidebar.tsx              Scene list (left).
  MeasurementPanel.tsx             Right panel: probe list, VSWR, time-series + FFT plots.
  PolarizationToggle.tsx           Header segmented control.
src/lib/fft.ts                     Radix-2 FFT.
src/App.tsx, App.css, main.tsx, index.css
docs/decisions/                    ADRs 0001–0009.
docs/handoff.md                    This file.
```

## Recent conversation context (M8)

This session implemented the full TEz fork in one bundle:
- ADR 0009 written first.
- Both engines now share `FDTDEngine` interface + a `polarization: Polarization` discriminator.
- `SourceSpec` gains optional `polarization: 'z' | 'x' | 'y'`. TMz ignores; TEz uses with default 'y'.
- Six new shaders (fdtd-e-tez, fdtd-h-tez, source-apply-tez, envelope-tez, probe-sample-tez, field-render-tez).
- Hz is split for PML (Hzx + Hzy); Ex/Ey are not split, each gets one axis of PML — symmetric to TMz.
- TEz probe samples Hz (signed out-of-page scalar, direct analog of Ez in TMz) so the spectrum analyzer pipeline stays polarization-agnostic.
- Header `PolarizationToggle` component lets the user manually swap engines. 3D button is visible-but-disabled with a tooltip pointing to M9.
- Each scene declares `polarization: 'TMz' | 'TEz'` — loading triggers `swapEngineTo` inside `GPUCanvas.applyScene`.
- PCB scenes now drive a `portColumn` of Ey sources across the substrate gap for clean TEM excitation (not single-cell, which excites parallel-plate harmonics).
- PCB scene names dropped the "(2D parallel-plate analog)" disclaimer — they're real microstrip / stripline / diff-pair physics now.

**What still needs browser verification** (TS + build are clean, but I couldn't open a browser):
- Engine swap on manual toggle — materials persist, fields clear.
- Scene auto-switch — microstrip → toggle flips to TEz visibly.
- TEz signed-Hz view shows a sensible amplitude (the DISPLAY_GAIN of 3.0 is a guess; may need tuning).
- TEz magnitude view shows the |E| standing wave on the microstrip.
- Source brush Ex/Ey radio appears + works in TEz.
- 3D button is correctly disabled.
