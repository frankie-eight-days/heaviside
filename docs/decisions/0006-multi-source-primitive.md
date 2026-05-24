# 0006 — Multi-source primitive via a separate compute pass

Status: Accepted
Date: 2026-05-23

## Context

M5a's source is a single cell whose position lives in a uniform `vec2<u32>`. The E shader has a tail-end branch:

```wgsl
if (i == u.source.x && j == u.source.y) {
  ezx[idx(i,j)] = u.source_value * 0.5;
  ezy[idx(i,j)] = u.source_value * 0.5;
}
```

This doesn't compose to multiple sources without ballooning the uniform or branching across many slots in the E shader. We need:

- **Differential pair** — two sources with opposite phase, driving a PCB structure.
- **Antenna arrays** — broadside, end-fire, Yagi-Uda. 2–10 driven elements with controlled phase.
- **Ports** — multi-cell sources driving the gap between two PEC structures (a microstrip's left-end drive between trace and ground).

Adding source state into the E shader's bindings runs into the **default 8-storage-buffers-per-stage WebGPU limit** that bit us in M4 ([ADR 0003](0003-per-cell-eps-sigma.md)). The E shader is already at 8 storage buffers.

## Decision

**Sources live in their own storage buffer; a dedicated compute pass writes their values into `ezx`/`ezy` each timestep, after the E pass.**

```
sources: array<Source>      // storage buffer, fixed capacity MAX_SOURCES = 32
source_count: u32           // uniform — how many slots are active
```

`Source` struct:

```wgsl
struct Source {
  pos: vec2<u32>,
  value: f32,
  _pad: u32,
};
```

16 bytes per source × 32 max = 512 bytes. Negligible.

### Per-timestep order

```
H pass → E pass → source-apply pass → envelope pass
```

Source-apply overwrites `ezx[src.pos]` and `ezy[src.pos]` with the source value. The envelope pass sees post-override values, so the source shows up in the magnitude view too.

### Why a separate pipeline (not in the E shader)

- Keeps the E shader at 8 storage bindings. Adding the sources buffer to the E shader would be 9, blowing the default limit.
- Decouples source delivery from the field update. Future source kinds (sheet currents, voltage ports with current-density spread over multiple cells) only need to change the source-apply pass.
- Source-apply is a tiny dispatch (1 workgroup of 32 threads) so its overhead is negligible.

### Source values are computed JS-side

JS owns per-source state:

```ts
interface SourceSpec {
  x: number, y: number       // grid cell
  phase: number              // radians, added to the carrier phase
  amplitude: number          // multiplied into the carrier
}
```

Each step, JS evaluates `amplitude · f(stepCount, period, phase, mode, pulseT0)` for every active source and writes the resulting `Source[]` to the storage buffer with a single `writeBuffer`.

This matches the M5a "modulation lives JS-side" rationale from [ADR 0004](0004-interactive-sources-and-magnitude.md) — and is the reason we don't need per-source mode/waveform on the GPU.

All sources share the engine's source mode (`off` / `cw` / `pulse`). Different elements of an array differ only in phase + amplitude. That covers every scene we want to ship.

### Port primitive — expanded at scene-load time

A "port" — multi-cell source driving a gap — is expressed at the *scene level* as a helper that calls `engine.setSources(...)` with a list of single-cell sources sharing identical phase and amplitude. Example:

```ts
const portCells = lineBetween({ x: 50, y: 30 }, { x: 50, y: 50 })
engine.setSources(portCells.map(([x, y]) => ({ x, y, phase: 0, amplitude: 1 })))
```

No special "port" type on the GPU side. The 32-slot cap means ports are limited to 32 cells, which is plenty for our 2D microstrip cross-sections.

### Render-shader source markers

The render shader binds the sources buffer too, iterates `u.source_count`, and draws a cyan ring at each. One ring per source, regardless of mode (CW/Pulse/Off).

## Consequences

- `Uniforms` struct repacks: remove `source: vec2<u32>` and `source_value: f32`, add `source_count: u32`. Total size stays 32 bytes after rebalancing pad.
- `setSource(x, y)` engine API replaced by `setSources(SourceSpec[])`. The UI "Source" tool calls `setSources([{x, y, phase: 0, amplitude: 1}])` on each click — single-source UX unchanged.
- New `src/shaders/source-apply.wgsl` compute pipeline.
- E shader's source-override tail block goes away.
- Render shader binding count: 5 → 6 storage buffers (still under the 8-stage limit).
- MAX_SOURCES = 32 hard-coded in both TS and the storage buffer size. If we need more later, bump in one place.

## Rejected alternatives

- **Pack all source state into the uniform buffer.** 32 sources × 16 bytes = 512 bytes; the default `maxUniformBufferBindingSize` is 64 KiB, so this fits, but every uniform-buffer rebind costs more, and we'd lose the ability to use `arrayLength()` over the sources.
- **Bump `maxStorageBuffersPerShaderStage` to 9+ at device creation.** Works on most desktop GPUs but is a soft compatibility hit. The separate-pipeline approach has no portability tradeoff and is structurally cleaner.
- **First-class "port" type on the GPU** (struct with extent, length, direction). More complex shader, harder to extend to non-rectangular ports. Scene-level expansion to single-cell sources keeps the GPU layer dumb.
