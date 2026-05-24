# 0003 — Per-cell ε and σ as continuous fields, PEC as a flag

Status: Accepted
Date: 2026-05-23

## Context

M3 shipped a four-value material enum: Vacuum / PEC / Lossy / Dielectric, with a single global `LOSSY_SIGMA = 1.0` and `DIELECTRIC_ER = 4.0` driving the shader. It worked for the M3 demo (paint metal, paint a glass slab) but forecloses the things M5–M6 need:

- M6 demo presets need specific εr values (Teflon 2.1, FR-4 ~4.4, water ~80). A four-slot enum can't express that.
- Lossy dielectrics (e.g. wet soil) need both ε and σ on the same cell. Two parallel enums double the slots and don't compose.
- The slider-while-drawing UX — pick "Dielectric", drag the εr slider, watch the painted material change in next stroke — is impossible with an enum keyed only to a hard-coded number.

## Decision

Replace the material enum with two storage buffers:

- `material: array<vec2<f32>>` (default `(1.0, 0.0)`) — packed (εr, σ) per cell. εr is the relative permittivity. σ is loss per cell, in the dimensionless half-step form `σ̄ = σ·Δt/(2·ε₀·εr)` that the M3 lossy update was already implicitly using.
- `flags: array<u32>` (default 0) — one bit currently used: `FLAG_PEC = 1`. Reserves headroom for PMC, source-tag, probe-tag later.

ε and σ are packed into a single `vec2<f32>` buffer (rather than two parallel `f32` buffers) so the E-update shader stays at exactly 8 storage buffer bindings — the default WebGPU `maxStorageBuffersPerShaderStage` limit. Going to 9 silently fails pipeline creation on Safari and gives you a black canvas with no console error. Don't add more storage buffers to the E pipeline without negotiating a higher limit at device creation.

The E-update computes Yee lossy coefficients **in-shader every step** from per-cell (εr, σ):

```
loss = σ · sc / (2 · εr)
Ca = (1 − loss) / (1 + loss)
Cb = (sc / εr) / (1 + loss)
```

PEC stays a hard `Ez = 0` clamp gated on `(flags[k] & FLAG_PEC)`, not modeled as σ→∞.

## Consequences

- GPU memory per cell goes 4 → 12 bytes (8 for the (εr, σ) vec2, 4 for flags). At 1024² that's 12 MB. Fine.
- σ is defined in the simulation's dimensionless half-step form, not SI S/m. M5/M6 must convert if they want to import SI material tables.
- Toolbar palette collapses to three buttons: Eraser / PEC / Material. Material reveals two sliders: **Dk** (= εr, dielectric constant) and **Df** (= tan δ, loss tangent), matching how RF/PCB datasheets specify materials. Real-material presets (Teflon, FR-4, Concrete, Foam absorber) live alongside the sliders. The shader still consumes (εr, σ); the UI converts Df → σ at the source frequency before constructing a brush.
- Painting PEC on a cell that previously held εr=4 wipes the εr back to 1. Otherwise erasing the PEC stroke would reveal "hidden" dielectric the user didn't paint.
- Materials still clear on resize. Snapshot-and-resample across a resize is a follow-up.
- Undo stack drops MAX_UNDO from 30 → 10. Each snapshot is now 12 bytes/cell instead of 4, so 30×12 MB = 360 MB at 1024² is too much. Bounding-box stroke snapshots are a follow-up.
- Adding µr later is a fourth f32 buffer with one new binding on the H pipeline. The structure already supports it.

## Calibration

The dimensionless form was chosen so M3 saved scenes look the same in M4:

- σ_slider = 1.0, εr = 1.0 → matches the M3 `MAT_LOSSY` cell exactly (`loss = sc/2 ≈ 0.354`).
- σ_slider = 0.0, εr = 4.0 → matches the M3 `MAT_DIELECTRIC` cell exactly (`Ca = 1`, `Cb = sc/4`).

Slider ranges: Dk ∈ [1, 12], Df ∈ [0, 2]. Dk cap is a UX call — the math is stable beyond 12, but visualization tint saturates and the wavelength compresses past the point of being useful in a 1024² grid. Df cap of 2 is far past any real material (FR-4 ≈ 0.02, salt water ≈ 1); use it for sandbox "extreme absorber" exploration.

### Df → σ conversion

Standard FDTD lossy-medium update needs σ, but engineering material catalogs ship `Df = tan δ`. Relation: `tan δ = σ / (ω · ε₀ · εr)`. Combining with the σ_slider definition gives:

```
σ_slider = (ω·Δt) · Dk · Df / Sc
```

where `ω·Δt = 2π / SOURCE_PERIOD` (here `SOURCE_PERIOD = 80` timesteps per source period) and `Sc = 1/√2`. The `dfToSigma(dk, df)` helper in `fdtd.ts` lives next to those constants so the UI doesn't have to import them.

This means Df is *evaluated at the source frequency*. A single-pole frequency-independent loss is fine for a single-tone sinusoidal excitation. Once M5 adds broadband Gaussian-pulse sources, we'll need a real Debye/Drude pole or per-frequency Df sweep — flagging it now so we don't accidentally rely on Df being a true material constant.

## Rejected alternatives

- **One `rg32float` storage texture** packing (ε, σ): WebGPU's 256-byte `bytesPerRow` requirement on `writeTexture` adds row-padding gymnastics to every paint upload. `writeBuffer` on flat `Float32Array`s is simpler and the bandwidth difference is invisible.
- **Precompute Ca/Cb into two more buffers on paint**: saves ~2 FMAs/cell/step at the cost of recomputing-and-uploading two coefficient buffers on every stroke, plus a stale-coefficient hazard if anything else mutates ε,σ. We're memory-bandwidth-bound, not FMA-bound; the in-shader path is cleaner.
- **PEC as σ→∞**: makes Ca approach −1 instead of 0, producing a ringing artifact at the metal boundary. The hard clamp is numerically cleaner and matches what M3 already did.
- **Separate Lossy and Dielectric brush modes** (the initial M4 attempt): forced an artificial split — physically the FDTD update is one equation in (εr, σ). Worse, Lossy hard-coded εr=1, which is fine for "metal block" but wrong for any real-world lossy dielectric (FR-4, wet soil). Merging into a single Material mode with Dk + Df is honest with the physics and matches how engineers think about substrates.
