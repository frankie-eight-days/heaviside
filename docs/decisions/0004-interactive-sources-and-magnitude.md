# 0004 — Interactive point source + EMA magnitude view

Status: Accepted
Date: 2026-05-23

## Context

M4 shipped per-cell materials but the source was still hard-coded: a single sinusoidal point source at the center of the grid, fixed frequency `SOURCE_PERIOD = 80` steps. To make the playground actually useful for antenna-style intuition (M6), we need to:

- Place the source wherever the user clicks.
- Tune the source frequency (so you can sweep across resonances of whatever PEC structure you painted).
- Switch between continuous-wave and short Gaussian pulses (CW shows steady radiation patterns; pulses show wavefront propagation cleanly without the standing-wave interference).
- Visualize **field magnitude / radiation pattern**, not just instantaneous Ez. The red/blue colormap is useful for "watch the wave," but you can't see a dipole's figure-eight lobe pattern from instantaneous Ez snapshots — you need the time-averaged envelope.

## Decision

### Source modulation lives JS-side, not in the shader

The shader continues to consume a single `source_value: f32` uniform set every step. All mode/timing logic — Off / CW / Pulse, pulse envelope, frequency — is computed in `step()` in TypeScript:

```
mode === 'off'   → source_value = 0
mode === 'cw'    → source_value = sin(2π · step / period)
mode === 'pulse' → source_value = exp(-((step - t0)/τ)²) · sin(2π · step / period)
```

Pulse width `τ = period`, peak at `t0 = stepCount + 4·τ` when `firePulse()` is called. Once `|step - t0|` is more than ~4τ, the envelope is negligible and the source is effectively silent until re-fired.

**Why JS-side:** the shader doesn't need to know about modes. Adding `source_mode`, `pulse_t0`, etc. as uniforms would mean more uniform slots, more branches in hot WGSL, and no actual performance gain since the source is a single-cell write per step. The current `_pad` slot in Uniforms is repurposed for `view_mode` (see below) but no new uniform fields are needed for sources.

### Magnitude view = peak-with-decay in a new compute pass

A new compute pipeline `envelope.wgsl` runs once per timestep after the E update:

```
env[k] = max(env[k] · DECAY, |Ez[k]|)    // DECAY = 0.997
```

Half-life ≈ 230 timesteps ≈ 3 source periods. Long enough that CW radiation lobes accumulate into a clean stable pattern; short enough that a Gaussian pulse leaves a trail that fades within a second or two of wall-clock time.

**Why peak-with-decay rather than running mean of ⟨Ez²⟩:**

- Peak tracks the standing-wave amplitude exactly (`env[k] → max|Ez[k]|` over the decay window). This is the textbook "field pattern."
- Running mean would also work but is slower to converge and noisier on transients.
- For broadband pulses, peak captures the strongest moment of the wavefront passage; running mean smears it.

Render shader gets a `view_mode: u32` uniform (Ez = 0, Magnitude = 1). In magnitude mode it samples `env[k]` instead of `Ez[k]` and applies a black→red→yellow→white heat colormap. Material tint dims by 50% in magnitude mode so the heat colors stay readable.

### Reset of envelope is tied to "Reset fields"

Hitting Reset fields zeros E, H, and env together. Lets the user replay a clean experiment without leftover lobes from the previous configuration. Painting materials does *not* reset env — you can paint a reflector, hit Fire, watch the envelope build, then paint more without losing the accumulated pattern.

### Source marker

Always-visible yellow ring (3-cell-wide outlined square at Chebyshev distance 2) drawn in the render shader at the source cell. The marker is drawn in both view modes and regardless of source mode, so the user knows where the source is even when it's Off or between pulses.

## Consequences

- Uniform struct gains `view_mode: u32` in the previously-padded slot. No struct size change (still 32 bytes).
- One new pipeline (envelope compute). 3 bindings: uniform, ezx, ezy, env. Well under the 8-buffer limit.
- Render shader bindings go from 5 → 6 (adds env). Still under the limit.
- React state grows: source position, source mode, source period, view mode. All passed through the engine's imperative handle (no new uniforms beyond view_mode).
- GPUCanvas gains a `tool` prop — `'paint' | 'source'`. In Source mode, pointer-down places the source; pointer-move/up are no-ops. Single tap, no drag.
- Source position uniform was already there; just becomes user-driven instead of fixed at center.

## Deferred to M5b

- **Plane-wave excitation.** Either a proper Total-Field / Scattered-Field boundary or a driven row of cells just inside the PML. Big enough to deserve its own ADR.
- **Multiple simultaneous sources** (arrays, broadside vs. end-fire). Once M5b lands the source-driving infrastructure, this is a natural follow-up: replace the single `source` vec2 with a small sources buffer.
