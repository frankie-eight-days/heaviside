# 0005 — App layout: examples left, canvas center, right reserved for M7

Status: Accepted
Date: 2026-05-23

## Context

Through M5, the app was a single column: header → toolbar → canvas. M6 introduces a library of named scenes (antennas, PCB structures, eventually optics) — that doesn't fit in a horizontal toolbar. M7 introduces probe-driven measurements (VSWR, S-params, FFT plots) that need persistent vertical space *next to* the canvas, not above it.

## Decision

Two-pane CSS Grid shell for M6, with a third column reserved for M7:

```
┌─────────────────────────────────────────────────┐
│ header (spans full width)                       │
├──────────┬──────────────────────────────────────┤
│          │ toolbar                              │
│ examples │                                      │
│ sidebar  ├──────────────────────────────────────┤
│ (240px)  │                                      │
│          │ canvas                               │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

The right-side measurement panel for M7 will slot in as a third grid column. Until then, the canvas claims that horizontal space.

Sidebar contents (M6):

- Collapsible category headers (Antennas, PCB).
- Each scene is a row with a name + one-line description; click loads the scene.
- Active scene gets a left-edge highlight bar.

The sidebar is **not** collapsible to zero-width in v1 — keeping it always visible reinforces that scenes are first-class. If sidebar width becomes a problem on small viewports we'll add a collapse toggle then.

## Consequences

- App.css gains a grid layout. Header, toolbar, canvas, sidebar are named grid areas.
- `Header` and `Toolbar` keep their existing markup; they just sit in different grid cells.
- A new `ExamplesSidebar` component reads from the scenes index and emits an `onSceneSelect(scene)` event up to App.
- `App.tsx` exposes the engine's imperative handle to the sidebar's click handler so scenes can call `engine.resetMaterials()`, `engine.paint(...)`, `engine.setSources(...)`, etc.

## Rejected alternatives

- **Modal scene picker.** A pop-up dropdown is less discoverable and breaks the "everything visible at once" feel that makes Falstad sims approachable.
- **Tab-based switching (Antennas / PCB / Optics as top tabs).** Hides categories you're not on, increases clicks to compare across categories.
- **Three columns from day one (sidebar / canvas / measurements).** Reserves visual space for content we don't have yet, making the app feel sparse. Better to add the right column when M7 ships actual measurements.
