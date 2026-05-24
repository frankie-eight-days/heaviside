# 0008 — Probe primitive: GPU ring buffer + mapAsync readback

Status: Accepted
Date: 2026-05-23

## Context

M7 turns the playground into a measurement instrument. The foundation is the **probe** — a click-placed point on the canvas that samples `Ez` over time. Everything else (spectrum analyzer, VSWR, S11) reads from probe time-series.

Probes need:

- **Time resolution**: capture *every* simulation timestep (4 per render frame), not just per-frame. Engineers expect to see the actual carrier, not aliased.
- **Frequency resolution for FFT**: at least 512–1024 samples per probe.
- **Low latency for display**: time-series plot should update at ≥15 Hz. Spectrum at 5–10 Hz is fine.
- **Decoupled from render loop**: the readback path can't block compute/render.

## Decision

### Per-probe GPU ring buffer + dedicated compute pass

```
sources buffer    (M6, write-each-step)        sources × 16 B
probes buffer     (probe positions, read-only) probes  ×  8 B
history buffer    (per-probe ring buffer)      probes × HISTORY_LEN × 4 B
```

A new compute pass `probe-sample.wgsl` runs once per timestep, after the envelope pass. One thread per probe writes the current `Ez` value into `history[p * HISTORY_LEN + head_index]`. The engine increments `head_index` modulo `HISTORY_LEN` each step.

Constants:

- `MAX_PROBES = 8`
- `HISTORY_LEN = 1024` (4 seconds at 240 samples/s)
- Total history buffer = 8 × 1024 × 4 B = 32 KB. Trivial.

### Readback via single-staging-buffer mapAsync

Each frame, after the compute submits:

1. `encoder.copyBufferToBuffer(historyBuffer, stagingBuffer)`
2. `stagingBuffer.mapAsync(GPUMapMode.READ)`
3. When the promise resolves, copy bytes into a JS `Float32Array` shadow + unmap.

Only one outstanding read at a time. If the previous readback hasn't resolved by the next frame, skip the readback that frame. This caps update rate at the GPU's roundtrip latency (usually 1 frame ≈ 16 ms → ~60 Hz), which is plenty for visualization.

The history shadow plus the engine's `head_index` lets the panel render samples in chronological order:

```ts
function chronological(shadow, head) {
  // Oldest sample is at index `head`; newest at `head - 1` mod length.
  // Rotate the ring into a linear array.
}
```

### Render-shader probe markers

Render shader binds the probes buffer, draws a 2-cell-wide **white outlined circle** at each probe position. White chosen so probes contrast both the source markers (cyan) and the magnitude heat ramp.

### Right-panel layout — three-pane app shell

```
┌────────────────────────────────────────────────────────┐
│ header                                                 │
├──────────┬─────────────────────────┬───────────────────┤
│ examples │ toolbar                 │ measurements      │
│ sidebar  ├─────────────────────────┤ panel             │
│          │                         │                   │
│          │ canvas                  │ - probe list      │
│          │                         │ - time series     │
│          │                         │ - spectrum (FFT)  │
└──────────┴─────────────────────────┴───────────────────┘
```

Measurements column is fixed-width 320 px. When no probes exist it shows an empty-state hint ("Pick the Probe tool and click to drop a probe"). The CSS grid was already designed in [ADR 0005](0005-app-layout.md) to anticipate this column.

### FFT — hand-rolled radix-2 Cooley-Tukey

No new dependency. The FFT is one ~100-line module. Sample window is the full ring buffer (1024 = 2¹⁰), giving 512 frequency bins. Plotted as |X[k]| vs. bin index, with the axis labeled both in "cycles per timestep" (engineering) and "wavelength in cells" (geometry).

## Consequences

- Uniforms struct grows: `probe_count: u32`, `history_head: u32`, `history_len: u32`. New struct size 48 bytes (was 32) — propagated to every shader.
- Three new GPU resources: `probesBuffer`, `historyBuffer`, `stagingBuffer`.
- One new compute pipeline.
- New JS dep-free FFT module.
- New `MeasurementPanel` component on the right; new `Probe` tool in the toolbar.
- App layout expands the CSS grid to a third column.

## Rejected alternatives

- **Per-step CPU readback (writeBuffer per step).** Round-trips kill performance. Even mapping every step at 240 Hz produces too much overhead.
- **CPU-side ring buffer fed by per-step JS reads.** Requires per-step GPU→CPU reads, same problem.
- **Web Audio AnalyserNode for FFT.** It's for audio buffers, not arbitrary data — and pulling in Web Audio for one method is the wrong abstraction.
- **External FFT library (fft.js, ndarray-fft).** All ship 10+ KB of code we don't need; radix-2 is 100 lines.

## Deferred to M7b+

- **VSWR / standing-wave display**: needs the "probe line" concept — a series of probes along a straight line, plotting `|Ez|` envelope vs. position. Pure UI work on top of M7a probes.
- **Waveform generators (square / triangle / AM / FM / arbitrary)**: just adds branches to the JS `evaluateSource` function. No GPU work.
- **S11 / reflection coefficient**: requires a *reference run* (same scene with matched termination) and FFT-based de-embedding. Real engineering work — its own ADR.
