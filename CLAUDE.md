# EM Playground

Browser-based 2D EM field solver, oriented toward **practical RF engineering pedagogy**: antennas, PCB transmission lines (microstrip / stripline / differential pair), and standard measurements (VSWR, S-parameters). Inspired by Falstad's circuit sims but with real FDTD physics underneath. Target deployment: free public site on Vercel.

The 2D TMz polarization happens to support both "antennas in free space, top-down" *and* "transmission line side-view, signal propagating along the trace" with the same physics — see [ADR 0002](docs/decisions/0002-2d-fdtd-tmz-first.md) and the M6 PCB scenes.

## Stack

- **Vite + React + TypeScript** for the app shell
- **WebGPU** for compute (FDTD updates) and render (field visualization)
- **WGSL** shaders, loaded via Vite's `?raw` imports

## Architecture

```
src/
├── gpu/
│   ├── init.ts          WebGPU adapter / device / canvas context setup
│   └── fdtd.ts          Engine factory: pipelines, bind groups, resize, step, paint, sources, view-mode
├── shaders/
│   ├── fdtd-e.wgsl      E-field update with per-cell ε,σ and a PEC flag bit
│   ├── fdtd-h.wgsl      H-field update (TMz: Hx, Hy)
│   ├── envelope.wgsl    Peak-with-decay EMA of |Ez| for the magnitude view
│   └── field-render.wgsl  Fullscreen-triangle field renderer (Ez or Magnitude)
├── components/
│   ├── GPUCanvas.tsx    React wrapper. Imperative GPU code lives here in useEffect.
│   └── Toolbar.tsx      Brush palette, sliders, source controls, view toggle, actions
├── scenes/              [M6+] Scene definitions for the Examples sidebar — antennas, PCB structures
├── App.tsx, main.tsx, *.css
docs/
└── decisions/           Numbered ADRs documenting architectural choices.
```

Compute-then-render per frame: H pass → E pass → envelope pass (per FDTD substep, STEPS_PER_FRAME times), then a single render pass to the swapchain. Field state lives in storage *buffers* (not textures — `writeBuffer` is simpler than `writeTexture` for the CPU-driven paint and source updates we do every frame).

**React handles the UI shell only.** Field state lives in GPU buffers. Do **not** try to make per-cell field values reactive; that's the wrong tool for the job and will be slow. Reactivity is fine for UI controls (sliders, brushes, source mode) that write into uniform / storage buffers.

**8-storage-buffer limit per shader stage.** The default WebGPU `maxStorageBuffersPerShaderStage` is 8. The E shader is at 8 (ezx, ezy, hx, hy, pml_x, pml_y, material, flags); adding more silently fails pipeline creation on Safari — see [ADR 0003](docs/decisions/0003-per-cell-eps-sigma.md). New shader bindings need to either pack into existing buffers, live in a separate compute pipeline, or negotiate a higher limit at device creation.

## Milestones

- [x] **M1 — GPU pipeline scaffold.** Vite+React+TS app with a working WebGPU compute → render loop. Placeholder kernel writes an animated radial ripple to confirm end-to-end plumbing. Aspect-correct, resizes with the window.
- [x] **M2 — Real 2D FDTD, no boundaries.** Yee-grid TMz update (`Ez`, `Hx`, `Hy`) running in two compute passes per timestep. Hard sinusoidal source at the grid center, PEC walls on all four edges. Waves reflect — instructive failure mode that motivates M3.
- [x] **M3 — PML absorbing boundaries.** Berenger split-field PML on all four sides, 12 cells thick, cubic σ profile targeting normal-incidence R=1e-6. Ez split into Ezx + Ezy in storage; physical Ez = their sum. Per-cell coefficients precomputed on resize, packed into 1D vec4 axis buffers.
- [x] **M4 — Material grid.** Per-cell `ε` and `σ` as continuous fields plus a PEC flag bit. Four-button brush palette (Vacuum / PEC / Lossy / Dielectric) with contextual εr or σ slider that adjusts the brush before each stroke. Reset fields and Reset materials are separate actions.
- [x] **M5a — Interactive point source + magnitude view.** Click to place the source. Wavelength slider. Off / CW / Pulse modulation with a Fire button (also bound to space). Ez ⇄ Magnitude view toggle; magnitude is a peak-with-decay EMA in its own compute pass, rendered with a black→red→yellow→white heat ramp.
- [x] **M6 — Examples library + multi-source.** Two-pane app shell: Examples sidebar (left, categorized — Antennas, PCB) + Canvas+Toolbar (right). One-click scene loader sets source(s), wavelength, source mode, view mode, paints PEC/materials, and (optionally) places probes. Multi-source primitive (sources buffer + dedicated compute pass) enables differential pairs and antenna arrays. "Port" source — a multi-cell driver across a gap — bridges electrical-circuit thinking to the EM domain. Initial scenes: 6 antennas (Hertzian, λ/2 dipole, Yagi-Uda, corner reflector, parabolic reflector, 2-element broadside array) + 3 PCB structures (microstrip, stripline, edge-coupled differential pair).
- [~] **M7a — Probes + spectrum analyzer.** Probe primitive (click to drop, max 8), GPU ring-buffer history (1024 samples per probe), async readback via mapAsync. Right-panel `MeasurementPanel` shows the selected probe's time waveform and FFT magnitude spectrum, live-updated every frame. Hand-rolled radix-2 FFT, no deps.
- [x] **M7b — VSWR + multi-probe analysis.** Probe tool supports click-drag for a line of probes (N controlled by a slider, max 32 probes total). Overlay canvas previews the line during drag. MeasurementPanel computes VSWR + |Γ| + return loss from max/min `|Ez|` across all probes. Per-probe metrics in the list: peak, RMS, phase relative to P1 (derived from FFT bin at source frequency). Spectrum plot gets a Linear/dB toggle with a −60 dB floor.
- [x] **M7c — Waveform generators.** Source modulation: sine / square (with tanh-shaped edge sharpness slider) / triangle / sawtooth / AM (carrier × `(1 + m·sin(ω_m t))`) / FM (`sin(ω_c t + β·sin(ω_m t))`). All computed JS-side in `evaluateSource()`; no shader work. Square / sawtooth excite harmonic combs visible in the spectrum analyzer; AM produces sidebands, FM produces Bessel-shaped multi-peaks.
- [ ] **M7d — S-parameters.** Reference-run de-embedding (run scene with matched load, store incident wave, subtract from total to get reflected). S11 magnitude + phase plot. Optional dB scale on the spectrum analyzer.
- [ ] **M8 — Plane wave excitation** (formerly M5b). TF/SF boundary or driven-row plane wave. Unlocks scattering / single-slit diffraction / frequency-selective surface demos.
- [ ] **M9 — 3D FDTD** (formerly M7). Extend to 3D. Volume rendering with slice planes. Near-to-far-field transforms for quantitative radiation patterns.

## Decisions

Architectural decisions are recorded in [`docs/decisions/`](docs/decisions/) as numbered Markdown ADRs (MADR-lite format). Before suggesting changes that contradict a prior decision, **read the relevant ADR first**. For new architectural forks, open a new ADR rather than just changing the code.

Current ADRs:
- [0001 — Stack: Vite + React + TS](docs/decisions/0001-stack-vite-react-ts.md)
- [0002 — 2D FDTD, TMz polarization first](docs/decisions/0002-2d-fdtd-tmz-first.md)
- [0003 — Per-cell ε and σ as continuous fields, PEC as a flag](docs/decisions/0003-per-cell-eps-sigma.md)
- [0004 — Interactive point source + EMA magnitude view](docs/decisions/0004-interactive-sources-and-magnitude.md)
- [0005 — App layout: examples sidebar + reserved measurement column](docs/decisions/0005-app-layout.md)
- [0006 — Multi-source primitive via a separate compute pass](docs/decisions/0006-multi-source-primitive.md)
- [0007 — Scenes as TypeScript modules with imperative apply](docs/decisions/0007-scene-format.md)
- [0008 — Probe primitive: GPU ring buffer + mapAsync readback](docs/decisions/0008-probe-primitive.md)

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

- WGSL files in `src/shaders/`, named with hyphens — `fdtd-e.wgsl`, `fdtd-h.wgsl`, `field-render.wgsl`, `envelope.wgsl`.
- TypeScript strict mode is on. No `any` without a justifying comment.
- Don't add error handling for states that can't happen. Trust internal invariants. Validate at boundaries (user input, browser APIs) only.
- No comments explaining WHAT — only WHY when non-obvious (subtle invariants, workarounds, surprising behavior).
- Bundle size matters: every dep ships to every user. Default to writing things ourselves before reaching for a library.
- For UI changes, verify in a real browser before declaring done. Type-checking and the build succeeding aren't the same as the feature working.
