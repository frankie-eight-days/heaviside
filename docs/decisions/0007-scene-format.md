# 0007 — Scenes are TypeScript modules with imperative `apply` functions

Status: Accepted
Date: 2026-05-23

## Context

M6 ships a library of preset scenes — antennas (Hertzian, λ/2 dipole, corner reflector, parabolic reflector, 2-element array) and PCB structures (microstrip, stripline, differential pair). Each scene needs to:

1. Reset materials and fields.
2. Paint specific PEC + material geometry sized to the current grid.
3. Place one or more sources with the right phase relationships.
4. Set frequency, source mode, view mode.

The question is how scenes are *described*.

## Decision

**Scenes are TypeScript modules exporting an imperative `apply(engine, dims) → void` function plus metadata.** No JSON, no declarative geometry DSL.

```ts
export const microstrip: Scene = {
  id: 'pcb-microstrip',
  category: 'pcb',
  name: 'Microstrip line',
  description: 'Trace over FR-4 substrate above a ground plane. Pulse fires down the line.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('pulse')
    engine.setViewMode('ez')

    const groundY = Math.floor(H * 0.7)
    const traceY  = Math.floor(H * 0.45)

    // Ground plane: full-width PEC strip
    engine.paint(W / 2, groundY, ...wideBar(W), { epsilonR: 1, sigma: 0, pec: true })
    // Trace: full-width PEC strip
    engine.paint(W / 2, traceY,  ...wideBar(W), { epsilonR: 1, sigma: 0, pec: true })
    // FR-4 substrate between them
    engine.paint(W / 2, (groundY + traceY) / 2, ..., { epsilonR: 4.4, sigma: dfToSigma(4.4, 0.02), pec: false })

    // Drive port at left end, between trace and ground
    engine.setSources(portColumn(20, traceY + 1, groundY - 1).map(...))
  },
}
```

Imperative rather than declarative because:

- Scenes need access to current grid dimensions to size geometry in cells. A λ/2 dipole is a different cell-count on a 1024×600 grid than a 800×500 grid. Declarative JSON would need its own evaluator that knew about `dims`.
- Some scenes do nontrivial work (parabolic reflector needs to plot a parabola). Embedding that in JSON is awkward; TS is the natural place.
- Bundle size is fine — scenes are small and tree-shaken (you only pay for the scenes you ship).
- Adding a new scene is "create a `.ts` file, add it to the index" — no schema migration, no runtime validation needed.

## Scene interface

```ts
export interface Scene {
  id: string                                // stable identifier, used in URLs eventually
  category: 'antennas' | 'pcb'              // future categories: 'optics', 'em-textbook'
  name: string                              // shown in the sidebar
  description: string                       // ≤140 chars, shown as a sublabel
  apply: (engine: FDTDEngine, dims: { width: number; height: number }) => void
}
```

`src/scenes/index.ts` re-exports an `ALL_SCENES: Scene[]` array. The sidebar reads from that.

## Helper library

A small `src/scenes/helpers.ts` provides the geometry primitives every scene needs:

- `paintRect(engine, x, y, w, h, brush)` — axis-aligned filled rectangle.
- `paintLine(engine, x1, y1, x2, y2, thickness, brush)` — Bresenham-thick line.
- `paintParabola(engine, focusX, focusY, openingDirection, depth, brush)` — for the parabolic reflector.
- `portColumn(x, y1, y2)` — list of cells for a vertical port between two y-coordinates.
- `arrayElements(centerX, centerY, count, spacing, axis)` — evenly-spaced source positions for arrays.
- `materialBrush(dk, df)` — wraps `dfToSigma` to construct a `BrushSpec` for non-PEC paint.

Helpers reduce each scene to ~20–40 lines of "set frequency, paint these shapes, place these sources."

## Consequences

- New `src/scenes/` directory.
- Scenes are imported by index.ts and tree-shaken — no runtime registration, no plugin system.
- Scene helpers (`paintRect`, etc.) sit next to the scene files. If a helper grows nontrivially we'd extract it, but for v1 keeping them co-located reduces friction.
- Existing `engine.paint(x, y, radius, brush)` works for the brush UX but is awkward for axis-aligned PCB geometry. Scene helpers wrap it.

## Rejected alternatives

- **JSON scenes.** Looks declarative but needs an interpreter that grows every time a scene wants a new primitive (parabola, port-cells, array-spacing). The interpreter ends up Turing-complete anyway. Just use TS.
- **A scene editor / GUI builder.** Big project for low value — most users want to load presets and tweak from there, not author from scratch. The current paint tools cover the "tweak" case.
- **Scenes live in `src/components/`.** Conflates UI with content. Scenes are *data* (with executable apply) and deserve their own directory.
