# 0002: Start with 2D FDTD, TMz polarization

**Status:** Accepted
**Date:** 2026-05-23

## Decision

The first working solver will be **2D FDTD on a Yee grid in TMz polarization** (fields: `Ez`, `Hx`, `Hy`). Extend to 3D later.

## Context

FDTD (Finite-Difference Time-Domain) on a Yee grid is the standard approach for time-domain EM simulation and maps cleanly onto GPU compute: two compute passes per timestep, each a stencil read of neighbors.

**Why 2D first:**

- A 1024×1024 grid updates at 60 fps on essentially any modern GPU; 3D at useful resolution requires a discrete GPU.
- All the hard parts (PML boundaries, material grid with ε/σ, source excitation, visualization) appear in 2D and carry over to 3D.
- Builds intuition faster — slider changes are visible in a single frame.

**Why TMz specifically:**

- `Ez` is a scalar field perpendicular to the screen. A point source on `Ez` is mathematically equivalent to a vertical wire antenna pointing out of the page. A line of `Ez` sources = a dipole.
- This means the visualization is **immediately meaningful** for antenna intuition: what you see is what you'd see slicing through a real 3D radiating wire.
- TEz (Hz, Ex, Ey) is better suited to waveguides and slot antennas — save for a later pass.

## Consequences

- 2D antenna demos are slices through a (conceptually) translationally-invariant geometry — fine for intuition, but **not quantitative** for 3D radiation patterns.
- Demos that inherently want 3D (monopole over ground plane radiation pattern, Yagi-Uda gain plots) will need either full 3D FDTD or a 2D-axisymmetric / BOR-FDTD shortcut.
- Code structure should keep the dimension and polarization abstract from the start so 3D / TEz are extensions, not rewrites.
- CFL stability condition for 2D: `Δt ≤ Δx / (c·√2)`. Hard-coded safety factor of ~0.99 of CFL limit is standard.
