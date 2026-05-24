# 0010 — 3D FDTD fork

Status: Accepted
Date: 2026-05-23

## Context

[ADR 0002](0002-2d-fdtd-tmz-first.md) deferred 3D because the hard parts (PML, materials, sources, visualization) all appear in 2D and carry over. [ADR 0009](0009-tez-polarization-fork.md) added a second 2D polarization so PCB scenes could show honest TEM physics. But there are demos that fundamentally don't fit in 2D:

- Vertical dipole → real 3D donut radiation pattern with a polar null
- Quarter-wave monopole over ground → image-theory half-donut
- Patch antenna → fringe-field pattern with both Ex and Ey components
- 3D Yagi with horizontal elements → directional in three dimensions
- Slot antenna → cuts through a 2D ground plane that doesn't exist in 2D
- Real microstrip propagation → fringing fields above the trace, not just between trace and ground

A 3D engine is also the only honest way to compute **antenna gain in dBi** (requires a full near-to-far-field transform over a 3D Huygens surface).

## Decision

**Add a 3D FDTD engine alongside the two 2D engines.** Parallel implementation (`src/gpu/fdtd-3d.ts`), separate `FDTDEngine3D` interface, selected via the existing header polarization toggle (third option, replacing today's disabled `3D (soon)` button). 2D remains the default landing experience.

### Engine equations (3D)

Standard Yee lattice with six field components:

```
Ex at (i+½, j, k)      Hx at (i, j+½, k+½)
Ey at (i, j+½, k)      Hy at (i+½, j, k+½)
Ez at (i, j, k+½)      Hz at (i+½, j+½, k)
```

Update equations (with per-cell ε, σ, and global μ = 1):

```
ε ∂Ex/∂t + σ Ex = ∂Hz/∂y − ∂Hy/∂z      μ ∂Hx/∂t = ∂Ey/∂z − ∂Ez/∂y
ε ∂Ey/∂t + σ Ey = ∂Hx/∂z − ∂Hz/∂x      μ ∂Hy/∂t = ∂Ez/∂x − ∂Ex/∂z
ε ∂Ez/∂t + σ Ez = ∂Hy/∂x − ∂Hx/∂y      μ ∂Hz/∂t = ∂Ex/∂y − ∂Ey/∂x
```

CFL tightens: **Sc_3D = 1/√3 ≈ 0.577** (vs 1/√2 in 2D).

### CPML over Berenger split-field PML

Berenger 1994 PML splits each field into sub-components (Ex → Exy + Exz). In 3D this is 12 sub-fields total and the resulting shader binding counts overflow the 8-storage-buffers-per-stage WebGPU limit easily. It also degrades to ~−20 dB reflection at grazing incidence — a problem for ground-plane scenes where waves run along the boundary.

**CPML (Roden & Gedney 2000)** keeps fields unsplit, adds auxiliary stretched-coordinate variables ψ that capture the convolution-style damping recurrence:

```
ψE_x_y[t+1] = b_y · ψE_x_y[t] + c_y · ∂Hz/∂y
ψE_x_z[t+1] = b_z · ψE_x_z[t] + c_z · ∂Hy/∂z

Ex[t+1] = ca · Ex[t] + cb · (∂Hz/∂y − ∂Hy/∂z + ψE_x_y − ψE_x_z)
```

Each field component has two ψ variables (one per axis it propagates in); we pack each pair into a single `vec2<f32>` buffer to halve the binding count. The per-axis coefficients (b, c, κ — the stretching factor) live in 1D `vec4` arrays mirroring the 2D PML structure.

**Why CPML is non-negotiable for us:** ground-plane scenes (monopole, microstrip, patch) propagate waves *along* the PML boundary at near-grazing incidence. Berenger produces visible ghost reflections there; CPML stays at −60 to −70 dB even at 1°. CPML also handles evanescent and DC components correctly, which matters for any scene with PEC structures touching the boundary.

### Shader buffer budget

Each E-component shader needs to fit in 8 storage buffers:

```
binding 0: uniform                     (always)
binding 1: Ex                          rw
binding 2: Hz                          r    (for ∂Hz/∂y term)
binding 3: Hy                          r    (for ∂Hy/∂z term)
binding 4: ψ_Ex_pack (vec2)            rw   (ψE_x_y, ψE_x_z packed)
binding 5: material (vec2: εr, σ)      r
binding 6: flags                       r
binding 7: pml_y (vec4: b_y, c_y, κ_y, _)  r
binding 8: pml_z (vec4: b_z, c_z, κ_z, _)  r
```

8 storage buffers + uniform — right at the limit. Same shape for Ey, Ez, Hx, Hy, Hz: three separate E shaders + three separate H shaders, six compute passes per timestep before source/probe/envelope.

Memory at the default 256³ grid (~1.4 GB total):
- 6 field buffers × 64 MB = 384 MB
- 6 ψ-pack buffers × 128 MB = 768 MB  (vec2 doubles the per-cell size)
- material + flags + envelope ≈ 256 MB

Each individual buffer is well under the WebGPU `maxBufferSize` default of 256 MB. 384³ (~2.8 GB) needs an `maxBufferSize: 2 GiB` extension at device creation.

### Visualization — three modes, shipped in order

1. **Slice planes** (M9a foundation, refined in M9d). Sample the 3D field at a fixed plane (XY at z=N, XZ at y=N, YZ at x=N) and render as 2D. Reuses ~all the 2D render-shader logic. Supports 1, 2, or 3 simultaneous slices with depth sliders.
2. **Volumetric ray-marching** (M9e). Per-pixel march through the 3D buffer, alpha-accumulate samples through a transfer function. Needs an orbit camera (θ, φ, zoom).
3. **Isosurfaces** (M9f). Marching-cubes compute pass extracts a mesh at the user-picked iso level; renders the mesh through the orbit camera.

Plus eventually (M9h): **far-field transform**. Integrate the field over a closed Huygens surface inside the grid, project to far field via Green's function, plot directivity in polar/spherical coordinates → real dBi gain numbers.

### Interaction model in 3D

Pointer events on a 2D canvas are inherently 2D. Two approaches:

- **Paint-on-active-slice.** Pointer events target the currently-focused slice plane; depth is the slice's depth coordinate. A brush "thickness" slider extends painting into adjacent slices for thick PEC bodies. Keeps the 2D mental model intact.
- **Ray-pick in 3D.** Cast a ray from the camera through the pointer, intersect with field magnitude or a manipulator. More natural in volume / isosurface modes, more code.

V1: paint-on-active-slice everywhere, including in volume and isosurface modes (the volume view shows a slice indicator). Ray-pick can come later if it's worth the complexity.

### Probe semantics

3D probes sample **Ez** (signed scalar, matches TMz convention). Most antenna scenes have Ez dominant for vertical orientation; user can override component per-probe in a future iteration. Spectrum analyzer, VSWR, phase analysis all work unchanged because they operate on a 1D time series.

### Architecture: parallel engine, shared shell

- **Engine** (`src/gpu/fdtd-3d.ts`, new) — distinct interface `FDTDEngine3D` with 3D dims, 3D paint/source/probe ops.
- **Engine factory** (`src/gpu/engine.ts`, extended) — dispatches by polarization.
- **GPUCanvas** — polarization-aware engine swap (already implemented for 2D, extended to 3D). 3D mode adds slice/camera controls and slice-targeted pointer mapping.
- **Toolbar, MeasurementPanel, ExamplesSidebar, scene system** — stay as-is. Scene `polarization` field expands to include `'3D'`.
- **PolarizationToggle** — the `3D (soon)` button becomes active.

### Scene polarization & sidebar filtering

Scenes declare `polarization: 'TMz' | 'TEz' | '3D'`. The sidebar filters scenes by current polarization (so 3D scenes only appear in 3D mode; selecting a 3D scene auto-switches to 3D).

### Defaults

- **Grid resolution: 256³** by default. User-controllable up to 512³ (with `maxBufferSize` extension requested at device creation).
- **Source default polarization: z** (vertical) — matches the most-common 3D demos (vertical dipole, monopole). xyz selectable in toolbar in 3D mode.
- **View mode default: XY slice at z = grid_depth / 2**.

## Consequences

- New files: `src/gpu/fdtd-3d.ts`, `src/shaders/fdtd-{ex,ey,ez,hx,hy,hz}-3d.wgsl`, `src/shaders/source-apply-3d.wgsl`, `src/shaders/probe-sample-3d.wgsl`, `src/shaders/envelope-3d.wgsl`, `src/shaders/field-render-3d.wgsl`.
- `FDTDEngine3D` interface in `fdtd.ts` (alongside `FDTDEngine`) — sharing the polarization-discriminator pattern.
- `GPUCanvas` gains 3D-mode controls (slice axis picker, depth sliders, view-mode picker).
- `Toolbar` source brush exposes `x | y | z` polarization in 3D (mirrors the `x | y` toggle that exists for TEz).
- `ExamplesSidebar` filters scenes by polarization.
- Scenes file gains a `3d/` subdirectory for the new scene category.
- `Polarization` type expands: `'TMz' | 'TEz' | '3D'`.

## Phased delivery

```
M9a — Engine foundation                       — vacuum + hard PEC + XY slice render
M9b — CPML                                    — all six faces, packed ψ
M9c — Materials + sources + probes (3D)       — per-cell ε/σ, xyz-polarized sources, 3D probes
M9d — Slice UI + paint-on-slice               — 1/2/3 slice modes, slice-axis picker, painting
M9e — Volumetric ray-march                    — orbit camera, transfer function
M9f — Isosurfaces                             — marching-cubes compute
M9g — 3D scenes                               — vertical λ/2 dipole, monopole/ground, patch, Yagi
M9h — Far-field transform (optional)          — Huygens surface + dBi polar plot
M9i — Polish + ADR updates                    — scene filtering, handoff, CLAUDE.md
```

## Rejected alternatives

- **2D-axisymmetric (BOR-FDTD).** Reduces certain cylindrically-symmetric problems to 2D in (r, z). Would catch the vertical-dipole donut pattern cheaply. Rejected because it only handles a narrow class of geometries; everything off-axis still wants full 3D.
- **Run 2D and 3D as separate apps.** Less risk of regression but splits the user experience. The shared header / sidebar / measurement panel is too valuable to give up.
- **Berenger 3D PML.** Documented above. Worse at grazing incidence and busts the buffer budget.
- **One unified `FDTDEngine` interface that handles both 2D and 3D.** Tried mentally; ends up with optional methods everywhere and runtime dimensionality checks. Cleaner to have two parallel interfaces.
- **Render via 3D textures instead of storage buffers.** Textures get hardware filtering during slice sampling, but we'd lose the easy compute-pass read/write pattern. Storage buffers are fine for our use; revisit if slice rendering becomes a bottleneck.

## Open follow-ups (out of M9 base scope)

- **Per-probe component selection** (sample Ex, Ey, Ez, or |E|).
- **Material brush as a 3D sphere** (currently we'll paint on the active slice only).
- **Camera bookmarks per scene** (so each scene loads with a sensible default view).
- **Symmetry-plane mirrors** (cut compute cost in half for symmetric geometries).
- **Time-domain reflectometry tools** (TDR plot in MeasurementPanel for transmission-line scenes).
