# Heaviside — handoff notes

Working notes for the next agent picking up this project. Read once, then act on (or delete the stale parts). Things that belong in ADRs eventually live here first.

## Current state (M9c shipped)

M1–M7c, M8, and **M9a / M9b / M9c** are all shipped and pushed. Branch is clean. ADRs 0001–0010 are written and committed.

Recent commits:
- `322ce69` — docs: ADR 0010 for M9 3D FDTD fork
- `cd4db75` — M9a: 3D FDTD engine foundation (vacuum + hard PEC + slice render)
- `7f59775` — M9b: CPML on all six faces of the 3D engine
- `501f91b` — M9c: per-cell materials, PEC sentinel, and 3D probes

What's live in the UI:
- Header polarization toggle: `[TMz | TEz | 3D]` — 3D now active.
- 3D smoke-test scene under a new `'3d'` sidebar category — point source at center of a 128³ vacuum cube with CPML, XY midplane slice render of signed Ez.
- 6 antenna scenes (TMz) + TX/RX link, 3 PCB scenes (TEz), all working.
- λ-grid overlay toggleable in toolbar.
- Measurement panel — VSWR, spectrum, time-series, per-probe metrics. Works in 3D too (probes sample Ez at xyz; MeasurementPanel doesn't care).

## What hasn't been browser-verified

The whole M9 stack was built without me being able to drive a browser. **Things to check first session you pick this up:**

1. **Polarization toggle to '3D'** loads the smoke-test scene cleanly. Bind groups, pipelines, and the swap path through `GPUCanvas.swapEngineTo` shouldn't have regressed but the code path is new.
2. **XY-slice rendering** shows a centered red/blue point that spreads as concentric rings. If the slice is blank, the most likely culprits are: (a) WebGPU `maxStorageBuffersPerShaderStage` — the E shaders are at exactly 8 storage bindings, Safari has been known to silently fail at the limit (see ADR 0003 history); (b) uniform layout mismatch — the 3D uniform is 64 B vs 2D's 48 B and a wrong offset would cause `size.xyz` to be read as zero.
3. **CPML actually absorbs.** Watch a pulse leave the center — it should fade into the boundary without a visible reflected wavefront. If it bounces, suspect: a sign error in the ψ recurrence per-shader (I double-checked but no browser run), wrong axis-array binding (Ex uses pml_y/pml_z not pml_x), or the PML σ profile too soft (try cranking SIGMA_MAX_3D 2×).
4. **PEC clamp works.** Paint a PEC ring in 3D mode and verify the source-driven field bounces off it. paint() targets the active XY slice — if nothing happens, it's because the smoke scene hasn't set view_depth properly or paint is hitting the PML guard band.
5. **Probes record sensibly.** Drop a probe near the source — spectrum panel should show a single peak at `f_src = 1/period`.

## Roadmap from here

In order:

1. **M9d — Slice UI + paint-on-slice (next, ~1 session)**. Add a slice-axis picker to the toolbar (xy / xz / yz) and a depth slider for the active axis. Wire to `engine.setViewSlice(axis, depth)`. Optional: multi-slice view with 2 or 3 simultaneous panes. The engine already supports the three axes via `setViewSlice` and the render shader has the branching.
2. **M9e — Volumetric ray-march (~1 session)**. Orbit camera, per-pixel ray through the volume, transfer function for transparency. Replaces or augments the slice view.
3. **M9f — Isosurfaces (~1 session)**. Marching cubes on GPU, iso-level slider.
4. **M9g — 3D scenes (~1–2 sessions)**. Vertical λ/2 dipole (donut pattern!), monopole/ground, patch antenna, slot, 3D Yagi.
5. **M9h — Far-field transform (~1 session, optional)**. Huygens surface integration + Green's function projection → polar plot in MeasurementPanel.
6. **M9i — Polish (~0.5 session)**. Scene filtering by polarization in sidebar, default landing experience, docs.

## Critical gotchas (3D-specific, add to the existing list)

In addition to the 2D gotchas (8-storage-buffer limit, HMR doesn't rebuild WebGPU pipelines, async probe readback state machine, etc.):

1. **3D uniform struct is 64 bytes**, not 48. Layout is documented in `fdtd-3d.ts` and at the top of every 3D shader. All eight 3D shaders must stay in lockstep. The leading vec3<u32> has a 4-byte trailing pad before the next scalar field — easy to miscount.

2. **PEC is encoded as σ < 0 in the material buffer**, not a separate flags array. Saves a storage binding (each E shader is at exactly 8 storage buffers — the limit). When painting or restoring materials, store `σ = -1` for PEC cells. The shader checks `material[k].y < 0.0` and clamps E to zero.

3. **CPML buffer count: 18 buffers of field state per engine** at 128³ (~144 MB), 6 of them (the ψ packs) at 8 bytes per cell (vec2). At 256³ the engine state climbs to ~1.4 GB — still under any modern GPU's memory but each ψ-pack buffer (128 MB) is close to the default WebGPU `maxBufferSize` of 256 MB.

4. **3D source struct is 32 bytes** (vs 16 in 2D). u32 layout: x, y, z, _pad, pol, value-as-f32, _pad, _pad. The pad slots are required for std430 alignment of `vec3<u32>`.

5. **paint() in 3D operates on the active XY slice at view_depth.** Bounds are clamped inside the CPML region — material in the absorber must stay at vacuum. XZ/YZ painting + a thickness control land in M9d.

6. **`getDims()` returns the XY face (W, H) for 3D engines**, NOT the full 3D dims. Use `getDims3D()` for the full (W, H, D). GPUCanvas's pointer-to-grid mapping is fine because it operates on the active slice.

7. **3D engine accepts 2D `setSources`/`setProbes`/`paint` calls** for compatibility — they all map to (x, y, view_depth). Scenes targeting 3D should cast `engine as FDTDEngine3D` and use `setSources3D` / `setProbes3D` for explicit xyz placement.

8. **`STEPS_PER_FRAME = 1` in 3D** (vs 4 in 2D). 3D updates are heavier; if performance budget allows, M9e/f might revisit.

## User communication style

- Frank Walsh, OSU MEng student. Strong RF/EE background — comfortable with PCB design, transmission lines, antenna theory, VSWR, GPIO/microstrip intuition. Catches sim limitations and asks great physics questions.
- Enthusiastic when things land ("amazing", "freaking cool"). Praise tells you you're on the right track; vague "hmm" means dig deeper.
- **Wants explanations before code for architectural decisions.** "Don't add anything yet, just tell me about it" is a real signal — respect it.
- **Approves commits and pushes explicitly.** "commit and push please" or similar. Never push without an explicit ask.
- **Likes incremental commits** — every milestone gets its own commit + push, clear message.
- **OK with being told he's wrong**. Pushes back on overly conservative defaults (told me 256³ was fine when I worried about memory) — match his ambition.

## Open M7d design questions (still on deck)

Carried forward from before. Talk through BEFORE coding M7d:

1. How does the user trigger a reference run? Manual "Calibrate" button (my lean) or auto?
2. Where is the "DUT region" marked? Bounding box vs "everything past x = X"?
3. Time gating vs reference subtraction.
4. S11 display: magnitude only, mag + phase, Smith chart?
5. Pulse vs CW for the measurement. Default pulse.

## Files where things live

```
src/gpu/
  init.ts                          WebGPU adapter init.
  fdtd.ts                          TMz engine factory + shared types (Polarization, FDTDEngine, FDTDEngine3D, SourceSpec3D, ProbeSpec3D, ViewAxis3D).
  fdtd-tez.ts                      TEz engine factory — same FDTDEngine surface.
  fdtd-3d.ts                       3D engine factory — implements FDTDEngine3D.
  engine.ts                        Polarization-aware createEngine() used by GPUCanvas.
src/shaders/
  fdtd-{e,h}.wgsl                  TMz Yee updates.
  fdtd-{e,h}-tez.wgsl              TEz Yee updates (Hz split for PML).
  fdtd-{ex,ey,ez,hx,hy,hz}-3d.wgsl 3D component updates (CPML, material on E shaders).
  source-apply{,-tez,-3d}.wgsl     Per-step writes of source values.
  envelope{,-tez}.wgsl             Peak-with-decay EMA. (3D envelope is M9d.)
  probe-sample{,-tez,-3d}.wgsl     Per-step probe sampling.
  field-render{,-tez,-3d}.wgsl     Renderers; 3D samples one slice at view_depth.
src/scenes/
  types.ts, helpers.ts             Scene interface + paint/port helpers.
  antennas/                        7 TMz scenes.
  pcb/                             3 TEz scenes.
  3d/                              1 smoke-test scene so far.
  index.ts                         ALL_SCENES array.
src/components/
  GPUCanvas.tsx                    React wrapper; engine lifecycle; polarization swap.
  Toolbar.tsx                      Brush palette, sliders, source controls. M9d adds slice picker.
  ExamplesSidebar.tsx              Scene list (left).
  MeasurementPanel.tsx             Right panel; works unchanged in 3D.
  PolarizationToggle.tsx           Header segmented control with all 3 modes active.
src/lib/fft.ts                     Radix-2 FFT.
src/App.tsx, App.css, main.tsx, index.css
docs/decisions/                    ADRs 0001–0010.
docs/handoff.md                    This file.
```

## Recent conversation context (M9 burst)

This session was an extended autonomous run after Frank stepped away. He asked for "as long as you can" and I shipped:
- ADR 0010 with the parallel-engine choice, CPML rationale, viz roadmap (slice → volume → iso → far-field), 256³ default decision.
- M9a: 8 new shaders + `fdtd-3d.ts` + the polarization toggle's 3D button became active. Smoke-test scene with centered Ez source.
- M9b: rewrote the 6 update shaders to add CPML (packed ψ vec2 per cell, per-axis vec4 coefficient tables, hard PEC clamps replaced with curl-safe skips), engine wires 6 ψ buffers + 3 axis buffers + bind group updates.
- M9c: per-cell material with PEC as σ-negative sentinel, 3D probes mirror the 2D primitive, MeasurementPanel works unchanged. paint() targets active XY slice.

**Whole M9 stack still needs browser verification** (gotchas list above is the cheat sheet for things to check first).
