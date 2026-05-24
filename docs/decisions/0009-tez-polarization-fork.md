# 0009 — TEz polarization fork

Status: Accepted
Date: 2026-05-23

## Context

[ADR 0002](0002-2d-fdtd-tmz-first.md) committed us to TMz (`Ez` out of page, `Hx, Hy` in plane) first. It made antenna pedagogy easy — a scalar `Ez` field is the same shape as the radiation pattern of a vertical wire, so what the canvas shows is what an EM textbook draws.

The cost showed up in M6: the PCB scenes can't model the textbook microstrip / stripline / CPW TEM mode. In our side-view geometry (trace at top, ground at bottom, signal propagating along `x`), the TEM mode has E pointing **vertically between conductors** and H **circulating around the trace, into the page**. TMz has neither degree of freedom — it only carries `Ez` out of the page. What our microstrip scene actually propagates is the parallel-plate TM₁ mode, which is honest but not what an RF engineer expects to see. The PCB scene cards were labeled "(2D parallel-plate analog)" specifically to admit this.

The next polarization fixes it. **TEz** (`Hz` out of page, `Ex, Ey` in plane) has:
- `Ey` pointing vertically between trace and ground — exactly the TEM E-field.
- `Hz` out of page — exactly the TEM H-field (in 2D cross-section, the loop around the trace becomes a scalar Hz).

So a microstrip in TEz shows the textbook field pattern. Same goes for stripline, differential pair (now showing odd-mode/even-mode E patterns), CPW, parallel-plate TEM, and edge-coupled lines.

TMz remains the right polarization for the antenna scenes — top-down view, scalar `Ez` is easy to read as "radiation amplitude at this point in space."

## Decision

**Add a 2D TEz engine as a parallel implementation alongside TMz.** Both engines implement a common `FDTDEngine` interface. The active polarization is **app-level state** controlled by a segmented control in the header (`[TMz] [TEz] [3D (soon)]`). Scenes declare their preferred polarization; loading a scene auto-switches the engine.

### Engine equations (TEz)

In 2D with `∂/∂z = 0`, the curl equations decouple into TM and TE polarizations. TEz is:

```
ε ∂Ex/∂t + σ Ex =  ∂Hz/∂y
ε ∂Ey/∂t + σ Ey = -∂Hz/∂x
μ ∂Hz/∂t        =  ∂Ex/∂y - ∂Ey/∂x
```

Yee staggering mirrors the TMz one (we split `Hz = Hzx + Hzy` for Berenger PML — symmetric to TMz splitting `Ez = Ezx + Ezy`).

### Why parallel engines, not a unified one

The principal field swaps roles (Ez ↔ Hz) and the in-plane fields swap roles too (Hx,Hy → Ex,Ey). Shaders for E-update and H-update fork cleanly, and the supplementary shaders (source-apply, probe-sample, envelope, render) all dereference the principal-field buffer, so they fork too. Branching inside a single shader for polarization would:
- pay a runtime branch cost per cell
- conflate buffer semantics in ways that are harder to reason about
- complicate adding the eventual 3D engine (which has 6 components — `Ex,Ey,Ez,Hx,Hy,Hz` — and doesn't fit the same "principal field + curl" pattern)

The duplication cost is bounded: each shader is ~50 lines and the math is mechanical. The engine factory (`src/gpu/fdtd-tez.ts`) mirrors `fdtd.ts` line-for-line on the structural code (bind groups, resize, source/probe machinery), only the field semantics differ.

### Shared `FDTDEngine` interface

Both engines expose the same factory shape so the React layer doesn't care which polarization is active:

```ts
export interface FDTDEngine {
  polarization: Polarization  // discriminator
  resize, step, destroy, paint, paintRect, resetMaterials, resetFields,
  setSources, placeSource, setSourcePeriod, setSourceMode, setSourceWaveform,
  setModulation, firePulse, setViewMode, setProbes, getProbeHistory,
  snapshotMaterials, restoreMaterials, getDims, pmlThickness
}
```

`SourceSpec` gains an optional `polarization: 'z' | 'x' | 'y'` field. TMz ignores it (always drives Ez). TEz uses it (default 'y' = vertical voltage source, alternative 'x' = horizontal). `'z'` in TEz is treated as 'y' for graceful scene compatibility.

`ViewMode` stays as `'ez' | 'magnitude'` to avoid a sweeping rename. The string `'ez'` is read by each engine as "the signed out-of-page scalar field":
- TMz: signed `Ez`
- TEz: signed `Hz`

`'magnitude'` is the peak-with-decay envelope of the dominant field:
- TMz: envelope of `|Ez|`
- TEz: envelope of `|E| = sqrt(Ex² + Ey²)`

The Toolbar relabels the button text based on the active polarization ("Ez" → "Hz") so the user sees the right physics name.

### Probe semantics

Probes sample the signed out-of-page scalar — `Ez` in TMz, `Hz` in TEz. This keeps the spectrum analyzer, VSWR, and phase analysis polarization-agnostic. For a TEM mode on a TL, `Hz` and `Ey` both vary sinusoidally along the line with the same VSWR ratio, so the measurement is correct either way; sampling `Hz` is the cleanest API.

### PEC handling in TEz

PEC requires zero tangential E. At a horizontal PEC strip, `Ex` is tangential (clamp to 0); `Ey` is normal (free). At a vertical PEC, swap. At corners or diagonals, both are partly tangential.

The simplest impl that's both textbook and stable: **where the PEC flag is set, clamp both `Ex` and `Ey` to zero.** This is a strict "perfect short" — slightly over-restrictive at curved or diagonal conductor surfaces (where one component should be free) but standard practice in intro FDTD textbooks. The same hammer is used for PEC in the TMz engine (clamps `Ez`).

### Polarization swap behavior

On manual toggle or scene-driven switch:
- **Materials grid preserved.** ε, σ, and PEC flags are geometry — polarization-agnostic.
- **Field state cleared.** Ez has no meaningful mapping to Ex/Ey/Hz.
- **Sources preserved.** Positions stay; `polarization` field default is re-applied if it was 'z' (TMz default → TEz default 'y').
- **Probes preserved.** Position-only, no field-history mapping; ring buffer is cleared.

The swap happens synchronously in `GPUCanvas.applyScene()` and in a `useEffect[polarization]` for manual toggles.

### Scene declaration

`Scene` interface gains an optional `polarization: Polarization` field. If absent, the scene runs in whatever polarization is currently active. PCB scenes set `polarization: 'TEz'`; antenna scenes either set `polarization: 'TMz'` or leave it unset (which means "I work fine in TMz, leave the current setting alone if user is exploring").

Loading a scene with a mismatched polarization auto-switches the toggle (chosen over greying out scenes — see "User feedback on UX" in the discussion).

## Consequences

- New files: `src/gpu/fdtd-tez.ts`, `src/shaders/fdtd-e-tez.wgsl`, `src/shaders/fdtd-h-tez.wgsl`, `src/shaders/source-apply-tez.wgsl`, `src/shaders/envelope-tez.wgsl`, `src/shaders/probe-sample-tez.wgsl`, `src/shaders/field-render-tez.wgsl`.
- `src/gpu/fdtd.ts` is now formally "the TMz engine"; its types (FDTDEngine, SourceSpec, etc.) become the shared interface contract.
- `App.tsx` owns `polarization` state; passes it to `GPUCanvas` and to `Toolbar` (which uses it to label the field/source-mode UI).
- PCB scenes are rewritten to drive `Ey` between trace and ground, and probes sample `Hz` along the channel. The "2D parallel-plate analog" disclaimer in scene names goes away.
- Antenna scenes keep `polarization: 'TMz'` (or unset). They could optionally get TEz cross-section versions later — not in scope for M8.
- The 8-storage-buffer-per-stage limit (ADR 0003) applies separately to each engine — neither exceeds 8.

## Rejected alternatives

- **Branch inside a single set of shaders.** Adds a hot-path uniform check per cell, costs us the clean buffer-naming we have, and doesn't help when M9 changes the structure entirely.
- **Per-scene polarization, no global toggle.** The header toggle was a direct user request (M8 chat, 2026-05-23). It also gives users an explicit way to compare "wrong polarization" vs "right polarization" for the same geometry — itself educational.
- **Grey-out scenes that don't match current polarization.** Considered, rejected — auto-switching is less friction and the manual override (switching to the "wrong" polarization on purpose) is itself a teaching moment.
- **Skip TEz, jump to 3D.** M9 is 5–10 sessions of work and harder to pedagogize at intermediate resolutions. TEz is ~3 sessions and fixes the single biggest honesty problem in the current scene library.

## Open follow-ups (out of M8 scope)

- **Per-source polarization UI** (radio button in the source brush when polarization='TEz'). Stubbed via the SourceSpec field; UI lands when a scene needs mixed-polarization drivers.
- **TEz antenna cross-sections** (patch antenna, slot antenna). Could be useful once we have a working TEz engine, but the M8 pedagogy gain is mostly on the PCB side.
- **`|E|` signed component view** (Ey-only or Ex-only render modes). Hz-signed and |E|-envelope are sufficient for v1.
