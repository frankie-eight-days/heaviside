# EM Playground

Browser-based electromagnetic field solver sandbox. Built for intuition — play with antennas, watch fields propagate, paint materials, see how waves interact with PEC and lossy media. Inspired by Falstad's circuit sims but focused on antennas and EM fields. Target deployment: free public site on Vercel.

## Stack

- **Vite + React + TypeScript** for the app shell
- **WebGPU** for compute (FDTD updates) and render (field visualization)
- **WGSL** shaders, loaded via Vite's `?raw` imports

## Architecture

```
src/
├── gpu/
│   ├── init.ts          WebGPU adapter / device / canvas context setup
│   └── demo.ts          Engine factory: pipelines, bind groups, resize, step
├── shaders/
│   ├── demo.compute.wgsl   Placeholder kernel (radial ripple) — to be replaced with FDTD
│   └── demo.render.wgsl    Fullscreen-triangle textured quad
├── components/
│   └── GPUCanvas.tsx    React wrapper. Imperative GPU code lives here in useEffect.
├── App.tsx, main.tsx, *.css
docs/
└── decisions/           Numbered ADRs documenting architectural choices.
```

Two-pass-per-frame pattern: compute shader writes field state to a storage texture, render shader samples it via a fullscreen triangle and emits to the swapchain. This same pattern carries over to real FDTD — only the compute kernel changes.

**React handles the UI shell only.** Field state lives in GPU buffers and storage textures. Do **not** try to make per-cell field values reactive; that's the wrong tool for the job and will be slow. Reactivity is fine for UI controls (sliders, presets, geometry tools) that write into a uniform buffer.

## Milestones

- [x] **M1 — GPU pipeline scaffold.** Vite+React+TS app with a working WebGPU compute → render loop. Placeholder kernel writes an animated radial ripple to confirm end-to-end plumbing. Aspect-correct, resizes with the window.
- [x] **M2 — Real 2D FDTD, no boundaries.** Yee-grid TMz update (`Ez`, `Hx`, `Hy`) running in two compute passes per timestep. Hard sinusoidal source at the grid center, PEC walls on all four edges. Waves reflect — instructive failure mode that motivates M3.
- [x] **M3 — PML absorbing boundaries.** Berenger split-field PML on all four sides, 12 cells thick, cubic σ profile targeting normal-incidence R=1e-6. Ez split into Ezx + Ezy in storage; physical Ez = their sum. Per-cell coefficients precomputed on resize, packed into 1D vec4 axis buffers.
- [x] **M4 — Material grid.** Per-cell `ε` and `σ` as continuous fields plus a PEC flag bit. Four-button brush palette (Vacuum / PEC / Lossy / Dielectric) with contextual εr or σ slider that adjusts the brush before each stroke. Reset fields and Reset materials are separate actions.
- [ ] **M5 — Source primitives.** Soft current sources, port excitations, plane waves. Gaussian-pulse time-domain source for broadband analysis.
- [ ] **M6 — Demo gallery.** Presets following antenna-theory.com: Hertzian dipole, half-wave dipole, monopole + ground plane, 2-element broadside vs end-fire array, Yagi-Uda, parabolic reflector, ...
- [ ] **M7 — 3D FDTD.** Extend to 3D. Volume rendering with slice planes. Near-to-far-field transforms for quantitative radiation patterns.

## Decisions

Architectural decisions are recorded in [`docs/decisions/`](docs/decisions/) as numbered Markdown ADRs (MADR-lite format). Before suggesting changes that contradict a prior decision, **read the relevant ADR first**. For new architectural forks, open a new ADR rather than just changing the code.

Current ADRs:
- [0001 — Stack: Vite + React + TS](docs/decisions/0001-stack-vite-react-ts.md)
- [0002 — 2D FDTD, TMz polarization first](docs/decisions/0002-2d-fdtd-tmz-first.md)
- [0003 — Per-cell ε and σ as continuous fields, PEC as a flag](docs/decisions/0003-per-cell-eps-sigma.md)

## Dev

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b + vite build
npm run typecheck  # tsc -b --noEmit
```

## Browser support

WebGPU required. Chrome / Edge 113+, Safari 26+, Firefox with `dom.webgpu.enabled` flag flipped on.

## Conventions

- WGSL files in `src/shaders/`, named `<topic>.<stage>.wgsl` (e.g. `fdtd.compute.wgsl`, `field.render.wgsl`).
- TypeScript strict mode is on. No `any` without a justifying comment.
- Don't add error handling for states that can't happen. Trust internal invariants. Validate at boundaries (user input, browser APIs) only.
- No comments explaining WHAT — only WHY when non-obvious (subtle invariants, workarounds, surprising behavior).
- Bundle size matters: every dep ships to every user. Default to writing things ourselves before reaching for a library.
- For UI changes, verify in a real browser before declaring done. Type-checking and the build succeeding aren't the same as the feature working.
