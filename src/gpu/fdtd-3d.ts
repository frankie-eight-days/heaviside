import exShaderSrc from '../shaders/fdtd-ex-3d.wgsl?raw'
import eyShaderSrc from '../shaders/fdtd-ey-3d.wgsl?raw'
import ezShaderSrc from '../shaders/fdtd-ez-3d.wgsl?raw'
import hxShaderSrc from '../shaders/fdtd-hx-3d.wgsl?raw'
import hyShaderSrc from '../shaders/fdtd-hy-3d.wgsl?raw'
import hzShaderSrc from '../shaders/fdtd-hz-3d.wgsl?raw'
import sourceApplyShaderSrc from '../shaders/source-apply-3d.wgsl?raw'
import probeSampleShaderSrc from '../shaders/probe-sample-3d.wgsl?raw'
import envelopeShaderSrc from '../shaders/envelope-3d.wgsl?raw'
import renderShaderSrc from '../shaders/field-render-3d.wgsl?raw'
import type { GPUContext } from './init'
import {
  MAX_PROBES,
  MAX_SOURCES,
  PROBE_HISTORY_LEN,
  type BrushSpec,
  type FDTDEngine3D,
  type MaterialSnapshot,
  type ModulationParams,
  type ProbeHistorySnapshot,
  type ProbeSpec,
  type ProbeSpec3D,
  type SourceMode,
  type SourcePolarization,
  type SourceSpec,
  type SourceSpec3D,
  type SourceWaveform,
  type ViewAxis3D,
  type ViewMode,
} from './fdtd'

// CFL: Δt ≤ Δx / (c·√3). Use 0.99 of the limit for safety.
const SC_3D = 0.99 / Math.sqrt(3)
const REFERENCE_PERIOD = 80

// 3D is much heavier per step than 2D. Start with 1 substep per frame; the
// slice render is cheap, the compute passes are the cost.
const STEPS_PER_FRAME = 1

// Default 128³ for M9a/b. ADR 0010 calls for 256³ as the "user-facing"
// default; we'll surface a resolution control in M9d.
const DEFAULT_DIM = 128

const SOURCE_STRIDE_BYTES = 32

// Simplified CPML — σ-only (no κ stretching, no α complex-frequency shift).
// 12-cell absorber matches the 2D PML thickness; reflection target R≈1e-6.
// See ADR 0010 for the trade-off vs Berenger split-field.
const PML_THICKNESS_3D = 12
const PML_ORDER_3D = 3
const PML_TARGET_R_3D = 1e-6
const SIGMA_MAX_3D =
  (-(PML_ORDER_3D + 1) * Math.log(PML_TARGET_R_3D)) / (2 * PML_THICKNESS_3D)

function sigmaAt3D(position: number, axisLen: number): number {
  if (position < PML_THICKNESS_3D) {
    const depth = PML_THICKNESS_3D - position
    return SIGMA_MAX_3D * Math.pow(depth / PML_THICKNESS_3D, PML_ORDER_3D)
  }
  if (position > axisLen - 1 - PML_THICKNESS_3D) {
    const depth = position - (axisLen - 1 - PML_THICKNESS_3D)
    return SIGMA_MAX_3D * Math.pow(depth / PML_THICKNESS_3D, PML_ORDER_3D)
  }
  return 0
}

// CPML recurrence coefficients for the ψ memory variable.
//   b = exp(-σ · Sc)
//   a = b - 1   (negative — multiplies the curl term in the ψ recurrence)
// When σ = 0 (outside PML) we return b=1, a=0 so ψ becomes a pass-through.
function cpmlCoeffs3D(sigma: number): [number, number] {
  if (sigma < 1e-12) return [1, 0]
  const b = Math.exp(-sigma * SC_3D)
  return [b, b - 1]
}

// Per-axis vec4 packs E-position and H-position coefficients:
//   .x = b_E, .y = a_E, .z = b_H, .w = a_H
function buildCpmlAxis3D(len: number): Float32Array {
  const out = new Float32Array(len * 4)
  for (let i = 0; i < len; i++) {
    const [bE, aE] = cpmlCoeffs3D(sigmaAt3D(i, len))
    const [bH, aH] = cpmlCoeffs3D(sigmaAt3D(i + 0.5, len))
    out[4 * i + 0] = bE
    out[4 * i + 1] = aE
    out[4 * i + 2] = bH
    out[4 * i + 3] = aH
  }
  return out
}

const DEFAULT_MOD: ModulationParams = {
  modPeriod: 400,
  amDepth: 0.5,
  fmIndex: 2,
  squareEdge: 20,
}

function polTo3D(p: SourcePolarization | undefined): number {
  if (p === 'x') return 1
  if (p === 'y') return 2
  // 'z' or undefined → drive Ez (the default for 3D, common to dipoles +
  // monopoles oriented vertically).
  return 3
}

export function createFDTD_3D(gpu: GPUContext, dim: number = DEFAULT_DIM): FDTDEngine3D {
  const { device, context, format } = gpu

  const W = dim
  const H = dim
  const D = dim

  // 64-byte uniform layout — see ADR 0010 for the field map.
  //   0:  size.xyz (vec3<u32>, 16 bytes incl. pad)
  //  16:  source_count
  //  20:  pml_thickness
  //  24:  sc (f32)
  //  28:  view_axis (0=XY, 1=XZ, 2=YZ)
  //  32:  view_depth
  //  36:  view_mode (0=signed Ez, 1=|E| — M9c)
  //  40:  probe_count
  //  44:  history_head
  //  48:  history_len
  //  52:  _pad ×3 (12 bytes)
  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformBytes = new ArrayBuffer(64)
  const uniformU32 = new Uint32Array(uniformBytes)
  const uniformF32 = new Float32Array(uniformBytes)
  uniformU32[0] = W
  uniformU32[1] = H
  uniformU32[2] = D
  // [3] padding
  uniformU32[4] = 0 // source_count
  uniformU32[5] = PML_THICKNESS_3D
  uniformF32[6] = SC_3D
  uniformU32[7] = 0 // view_axis = XY
  uniformU32[8] = Math.floor(D / 2) // view_depth at midplane
  uniformU32[9] = 0 // view_mode = signed Ez
  uniformU32[10] = 0 // probe_count
  uniformU32[11] = 0 // history_head
  uniformU32[12] = PROBE_HISTORY_LEN

  function writeUniforms() {
    device.queue.writeBuffer(uniformBuffer, 0, uniformBytes)
  }

  // Six field buffers, each W×H×D×4 bytes. At 128³ = 8 MB each, 48 MB total.
  // At 256³ this becomes 64 MB each, 384 MB total (still under WebGPU's
  // default maxBufferSize of 256 MB per buffer).
  const fieldBytes = W * H * D * 4
  const fieldUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const exBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
  const eyBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
  const ezBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
  const hxBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
  const hyBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
  const hzBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
  // Peak-with-decay |E| envelope for the magnitude view.
  const envBuf = device.createBuffer({ size: fieldBytes, usage: fieldUsage })

  // CPML ψ memory variables — 6 packed buffers (vec2<f32> per cell). One
  // pair per field component, holding the two axis-conjugate ψ values.
  // 128³ × 8 B = 16 MB per buffer; 6 × 16 MB = 96 MB total at default dim.
  const psiBytes = W * H * D * 8
  const psiExBuf = device.createBuffer({ size: psiBytes, usage: fieldUsage })
  const psiEyBuf = device.createBuffer({ size: psiBytes, usage: fieldUsage })
  const psiEzBuf = device.createBuffer({ size: psiBytes, usage: fieldUsage })
  const psiHxBuf = device.createBuffer({ size: psiBytes, usage: fieldUsage })
  const psiHyBuf = device.createBuffer({ size: psiBytes, usage: fieldUsage })
  const psiHzBuf = device.createBuffer({ size: psiBytes, usage: fieldUsage })

  // Per-axis CPML coefficient tables (vec4 per cell: b_E, a_E, b_H, a_H).
  // Tiny — at most 4 KB per axis at the 256-cell default.
  const pmlXData = buildCpmlAxis3D(W)
  const pmlYData = buildCpmlAxis3D(H)
  const pmlZData = buildCpmlAxis3D(D)
  const pmlAxisUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const pmlXBuf = device.createBuffer({ size: pmlXData.byteLength, usage: pmlAxisUsage })
  const pmlYBuf = device.createBuffer({ size: pmlYData.byteLength, usage: pmlAxisUsage })
  const pmlZBuf = device.createBuffer({ size: pmlZData.byteLength, usage: pmlAxisUsage })
  device.queue.writeBuffer(pmlXBuf, 0, pmlXData)
  device.queue.writeBuffer(pmlYBuf, 0, pmlYData)
  device.queue.writeBuffer(pmlZBuf, 0, pmlZData)

  // Zero-init ψ. We reuse this oversized zero buffer for the field-reset
  // path too — fields are W*H*D*4 bytes, ψ are W*H*D*8 bytes; a single
  // Float32Array sized for ψ covers both via writeBuffer's offset/length.
  const zeroPsi = new Float32Array(W * H * D * 2)
  device.queue.writeBuffer(psiExBuf, 0, zeroPsi)
  device.queue.writeBuffer(psiEyBuf, 0, zeroPsi)
  device.queue.writeBuffer(psiEzBuf, 0, zeroPsi)
  device.queue.writeBuffer(psiHxBuf, 0, zeroPsi)
  device.queue.writeBuffer(psiHyBuf, 0, zeroPsi)
  device.queue.writeBuffer(psiHzBuf, 0, zeroPsi)

  // Sources buffer — 32 B/source (vec3 pos + pol + value + 12 B pad).
  const sourcesBuffer = device.createBuffer({
    size: MAX_SOURCES * SOURCE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sourcesBytes = new ArrayBuffer(MAX_SOURCES * SOURCE_STRIDE_BYTES)
  const sourcesU32 = new Uint32Array(sourcesBytes)
  const sourcesF32 = new Float32Array(sourcesBytes)

  // Material buffer — vec2<f32>(εr, σ) per cell. σ < 0 sentinel = PEC.
  // 16 MB at 128³, 128 MB at 256³ (under WebGPU's 256 MB maxBufferSize).
  const materialBytes = W * H * D * 8
  const materialBuffer = device.createBuffer({
    size: materialBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  // JS-side mirror of the material grid. epsSig[2k] = εr, epsSig[2k+1] = σ.
  const epsSigGrid = new Float32Array(W * H * D * 2)
  for (let i = 0; i < W * H * D; i++) epsSigGrid[2 * i] = 1.0 // vacuum εr
  device.queue.writeBuffer(materialBuffer, 0, epsSigGrid)

  // Probes — vec4<u32>(x, y, z, _pad) per probe.
  const probesBuffer = device.createBuffer({
    size: MAX_PROBES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const probesBytes = new ArrayBuffer(MAX_PROBES * 16)
  const probesU32 = new Uint32Array(probesBytes)

  const HISTORY_BYTES = MAX_PROBES * PROBE_HISTORY_LEN * 4
  const historyBuffer = device.createBuffer({
    size: HISTORY_BYTES,
    usage:
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const probeStagingBuffer = device.createBuffer({
    size: HISTORY_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const probeHistoryShadow = new Float32Array(MAX_PROBES * PROBE_HISTORY_LEN)
  type ReadbackState = 'idle' | 'in-flight'
  let probeReadbackState: ReadbackState = 'idle'

  // Compute pipelines (one per E + H component, plus source-apply).
  const exPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: exShaderSrc }), entryPoint: 'main' },
  })
  const eyPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: eyShaderSrc }), entryPoint: 'main' },
  })
  const ezPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: ezShaderSrc }), entryPoint: 'main' },
  })
  const hxPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: hxShaderSrc }), entryPoint: 'main' },
  })
  const hyPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: hyShaderSrc }), entryPoint: 'main' },
  })
  const hzPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: hzShaderSrc }), entryPoint: 'main' },
  })
  const sourceApplyPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: sourceApplyShaderSrc }),
      entryPoint: 'main',
    },
  })
  const probeSamplePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: probeSampleShaderSrc }),
      entryPoint: 'main',
    },
  })
  const envPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: envelopeShaderSrc }),
      entryPoint: 'main',
    },
  })

  const renderModule = device.createShaderModule({ code: renderShaderSrc })
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: {
      module: renderModule,
      entryPoint: 'fs',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })

  // Bind groups — each E shader binds: uniform, target field, two curl-input
  // fields, ψ pack, two axis PML tables, plus the material buffer (per-cell
  // εr and σ). H shaders skip material (μ=1 everywhere in our model).
  const exBindGroup = device.createBindGroup({
    layout: exPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: exBuf } },
      { binding: 2, resource: { buffer: hzBuf } },
      { binding: 3, resource: { buffer: hyBuf } },
      { binding: 4, resource: { buffer: psiExBuf } },
      { binding: 5, resource: { buffer: pmlYBuf } },
      { binding: 6, resource: { buffer: pmlZBuf } },
      { binding: 7, resource: { buffer: materialBuffer } },
    ],
  })
  const eyBindGroup = device.createBindGroup({
    layout: eyPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: eyBuf } },
      { binding: 2, resource: { buffer: hxBuf } },
      { binding: 3, resource: { buffer: hzBuf } },
      { binding: 4, resource: { buffer: psiEyBuf } },
      { binding: 5, resource: { buffer: pmlZBuf } },
      { binding: 6, resource: { buffer: pmlXBuf } },
      { binding: 7, resource: { buffer: materialBuffer } },
    ],
  })
  const ezBindGroup = device.createBindGroup({
    layout: ezPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: ezBuf } },
      { binding: 2, resource: { buffer: hyBuf } },
      { binding: 3, resource: { buffer: hxBuf } },
      { binding: 4, resource: { buffer: psiEzBuf } },
      { binding: 5, resource: { buffer: pmlXBuf } },
      { binding: 6, resource: { buffer: pmlYBuf } },
      { binding: 7, resource: { buffer: materialBuffer } },
    ],
  })
  const hxBindGroup = device.createBindGroup({
    layout: hxPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hxBuf } },
      { binding: 2, resource: { buffer: eyBuf } },
      { binding: 3, resource: { buffer: ezBuf } },
      { binding: 4, resource: { buffer: psiHxBuf } },
      { binding: 5, resource: { buffer: pmlZBuf } },
      { binding: 6, resource: { buffer: pmlYBuf } },
    ],
  })
  const hyBindGroup = device.createBindGroup({
    layout: hyPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hyBuf } },
      { binding: 2, resource: { buffer: ezBuf } },
      { binding: 3, resource: { buffer: exBuf } },
      { binding: 4, resource: { buffer: psiHyBuf } },
      { binding: 5, resource: { buffer: pmlXBuf } },
      { binding: 6, resource: { buffer: pmlZBuf } },
    ],
  })
  const hzBindGroup = device.createBindGroup({
    layout: hzPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hzBuf } },
      { binding: 2, resource: { buffer: exBuf } },
      { binding: 3, resource: { buffer: eyBuf } },
      { binding: 4, resource: { buffer: psiHzBuf } },
      { binding: 5, resource: { buffer: pmlYBuf } },
      { binding: 6, resource: { buffer: pmlXBuf } },
    ],
  })
  const sourceApplyBindGroup = device.createBindGroup({
    layout: sourceApplyPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: sourcesBuffer } },
      { binding: 2, resource: { buffer: exBuf } },
      { binding: 3, resource: { buffer: eyBuf } },
      { binding: 4, resource: { buffer: ezBuf } },
    ],
  })
  const probeSampleBindGroup = device.createBindGroup({
    layout: probeSamplePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: probesBuffer } },
      { binding: 2, resource: { buffer: ezBuf } },
      { binding: 3, resource: { buffer: historyBuffer } },
    ],
  })
  const envBindGroup = device.createBindGroup({
    layout: envPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: exBuf } },
      { binding: 2, resource: { buffer: eyBuf } },
      { binding: 3, resource: { buffer: ezBuf } },
      { binding: 4, resource: { buffer: envBuf } },
    ],
  })
  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: ezBuf } },
      { binding: 2, resource: { buffer: envBuf } },
      { binding: 3, resource: { buffer: materialBuffer } },
    ],
  })

  let stepCount = 0
  let sourcePeriod = REFERENCE_PERIOD
  let sourceMode: SourceMode = 'cw'
  let sourceWaveform: SourceWaveform = 'sine'
  const modulation: ModulationParams = { ...DEFAULT_MOD }
  let pulseT0 = -1
  let sources: SourceSpec3D[] = []
  let probes: ProbeSpec3D[] = []
  let probeHistoryHead = 0

  function uploadMaterial() {
    device.queue.writeBuffer(materialBuffer, 0, epsSigGrid)
  }

  function cellIndex(i: number, j: number, k: number): number {
    return i + j * W + k * W * H
  }

  // Map a (slice-plane-a, slice-plane-b, depth) tuple to (x, y, z) given the
  // current view_axis. The "slice plane axes" follow the field-render-3d
  // shader's UV mapping: XY → (x, y) fixed-z; XZ → (x, z) fixed-y; YZ → (y, z)
  // fixed-x. depth always plugs into the remaining axis.
  function sliceToVolume(a: number, b: number): [number, number, number] {
    const axis = uniformU32[7]
    const depth = uniformU32[8]
    if (axis === 0) return [a, b, depth]
    if (axis === 1) return [a, depth, b]
    return [depth, a, b]
  }

  function sliceFaceDims(): [number, number, number] {
    const axis = uniformU32[7]
    // (face-a max, face-b max, depth-axis max)
    if (axis === 0) return [W, H, D]
    if (axis === 1) return [W, D, H]
    return [H, D, W]
  }

  function waveformValue(phase: number): number {
    switch (sourceWaveform) {
      case 'sine':
        return Math.sin(phase)
      case 'square':
        return Math.tanh(modulation.squareEdge * Math.sin(phase))
      case 'triangle':
        return (2 / Math.PI) * Math.asin(Math.sin(phase))
      case 'sawtooth': {
        const t = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        return t / Math.PI - 1
      }
      case 'am': {
        const modPhase = (2 * Math.PI * stepCount) / modulation.modPeriod
        const m = modulation.amDepth
        return ((1 + m * Math.sin(modPhase)) * Math.sin(phase)) / (1 + m)
      }
      case 'fm': {
        const modPhase = (2 * Math.PI * stepCount) / modulation.modPeriod
        return Math.sin(phase + modulation.fmIndex * Math.sin(modPhase))
      }
    }
  }

  function evaluateSource(spec: SourceSpec3D): number {
    if (sourceMode === 'off') return 0
    const phase = (2 * Math.PI * stepCount) / sourcePeriod + spec.phase
    const carrier = waveformValue(phase) * spec.amplitude
    if (sourceMode === 'cw') return carrier
    if (pulseT0 < 0) return 0
    const tau = sourcePeriod
    const dt = (stepCount - pulseT0) / tau
    if (Math.abs(dt) > 5) return 0
    return Math.exp(-dt * dt) * carrier
  }

  function writeSources() {
    new Uint8Array(sourcesBytes).fill(0)
    const n = sources.length
    // 32-byte stride: pos.xyz (12) + pad (4) + value (4) + pol (4) + pad (8).
    // u32 offsets per source: 0=x, 1=y, 2=z, 3=pad, 4=pol, 5=value(as f32),
    // 6+7 = pad. Note the order matches `struct Source3D` in source-apply-3d.wgsl.
    for (let i = 0; i < n; i++) {
      const s = sources[i]
      const base = i * 8 // 32 bytes / 4 bytes per u32 = 8 slots
      sourcesU32[base + 0] = s.x
      sourcesU32[base + 1] = s.y
      sourcesU32[base + 2] = s.z
      // base + 3 = padding (vec3 alignment)
      sourcesU32[base + 4] = polTo3D(s.polarization)
      sourcesF32[base + 5] = evaluateSource(s)
    }
    device.queue.writeBuffer(sourcesBuffer, 0, sourcesBytes)
  }

  function dispatchFieldCompute(pass: GPUComputePassEncoder) {
    pass.dispatchWorkgroups(
      Math.ceil(W / 4),
      Math.ceil(H / 4),
      Math.ceil(D / 4),
    )
  }

  function step() {
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      if (sourceMode === 'pulse' && pulseT0 >= 0) {
        const dt = (stepCount - pulseT0) / sourcePeriod
        if (dt > 5) pulseT0 = -1
      }
      writeUniforms()
      writeSources()

      const encoder = device.createCommandEncoder()

      // H update (all 3 components).
      const hxPass = encoder.beginComputePass()
      hxPass.setPipeline(hxPipeline)
      hxPass.setBindGroup(0, hxBindGroup)
      dispatchFieldCompute(hxPass)
      hxPass.end()

      const hyPass = encoder.beginComputePass()
      hyPass.setPipeline(hyPipeline)
      hyPass.setBindGroup(0, hyBindGroup)
      dispatchFieldCompute(hyPass)
      hyPass.end()

      const hzPass = encoder.beginComputePass()
      hzPass.setPipeline(hzPipeline)
      hzPass.setBindGroup(0, hzBindGroup)
      dispatchFieldCompute(hzPass)
      hzPass.end()

      // E update.
      const exPass = encoder.beginComputePass()
      exPass.setPipeline(exPipeline)
      exPass.setBindGroup(0, exBindGroup)
      dispatchFieldCompute(exPass)
      exPass.end()

      const eyPass = encoder.beginComputePass()
      eyPass.setPipeline(eyPipeline)
      eyPass.setBindGroup(0, eyBindGroup)
      dispatchFieldCompute(eyPass)
      eyPass.end()

      const ezPass = encoder.beginComputePass()
      ezPass.setPipeline(ezPipeline)
      ezPass.setBindGroup(0, ezBindGroup)
      dispatchFieldCompute(ezPass)
      ezPass.end()

      if (sources.length > 0) {
        const srcPass = encoder.beginComputePass()
        srcPass.setPipeline(sourceApplyPipeline)
        srcPass.setBindGroup(0, sourceApplyBindGroup)
        srcPass.dispatchWorkgroups(Math.ceil(MAX_SOURCES / 64))
        srcPass.end()
      }

      const envPass = encoder.beginComputePass()
      envPass.setPipeline(envPipeline)
      envPass.setBindGroup(0, envBindGroup)
      dispatchFieldCompute(envPass)
      envPass.end()

      if (probes.length > 0) {
        // history_head needs to point at the slot to be written this step.
        uniformU32[11] = probeHistoryHead
        writeUniforms()
        const probePass = encoder.beginComputePass()
        probePass.setPipeline(probeSamplePipeline)
        probePass.setBindGroup(0, probeSampleBindGroup)
        probePass.dispatchWorkgroups(1)
        probePass.end()
      }

      device.queue.submit([encoder.finish()])
      stepCount++
      probeHistoryHead = (probeHistoryHead + 1) % PROBE_HISTORY_LEN
    }

    const encoder = device.createCommandEncoder()
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    renderPass.setPipeline(renderPipeline)
    renderPass.setBindGroup(0, renderBindGroup)
    renderPass.draw(3)
    renderPass.end()
    device.queue.submit([encoder.finish()])

    tryStartProbeReadback()
  }

  function tryStartProbeReadback() {
    if (probes.length === 0 || probeReadbackState !== 'idle') return
    const encoder = device.createCommandEncoder()
    encoder.copyBufferToBuffer(historyBuffer, 0, probeStagingBuffer, 0, HISTORY_BYTES)
    device.queue.submit([encoder.finish()])
    probeReadbackState = 'in-flight'
    probeStagingBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const view = new Float32Array(probeStagingBuffer.getMappedRange())
        probeHistoryShadow.set(view)
        probeStagingBuffer.unmap()
        probeReadbackState = 'idle'
      })
      .catch((err) => {
        console.error('3D probe readback mapAsync failed', err)
        probeReadbackState = 'idle'
      })
  }

  function resetFields() {
    // zeroPsi is sized for the larger ψ buffers; subarray covers fields.
    const fieldZeros = zeroPsi.subarray(0, W * H * D)
    device.queue.writeBuffer(exBuf, 0, fieldZeros)
    device.queue.writeBuffer(eyBuf, 0, fieldZeros)
    device.queue.writeBuffer(ezBuf, 0, fieldZeros)
    device.queue.writeBuffer(hxBuf, 0, fieldZeros)
    device.queue.writeBuffer(hyBuf, 0, fieldZeros)
    device.queue.writeBuffer(hzBuf, 0, fieldZeros)
    device.queue.writeBuffer(envBuf, 0, fieldZeros)
    device.queue.writeBuffer(psiExBuf, 0, zeroPsi)
    device.queue.writeBuffer(psiEyBuf, 0, zeroPsi)
    device.queue.writeBuffer(psiEzBuf, 0, zeroPsi)
    device.queue.writeBuffer(psiHxBuf, 0, zeroPsi)
    device.queue.writeBuffer(psiHyBuf, 0, zeroPsi)
    device.queue.writeBuffer(psiHzBuf, 0, zeroPsi)
    stepCount = 0
    pulseT0 = -1
  }

  function setSources3D(specs: SourceSpec3D[]) {
    sources = specs.slice(0, MAX_SOURCES).map((s) => ({
      x: Math.max(0, Math.min(W - 1, Math.floor(s.x))),
      y: Math.max(0, Math.min(H - 1, Math.floor(s.y))),
      z: Math.max(0, Math.min(D - 1, Math.floor(s.z))),
      phase: s.phase,
      amplitude: s.amplitude,
      polarization: s.polarization,
    }))
    uniformU32[4] = sources.length
    writeUniforms()
    writeSources()
  }

  // 2D-shaped setSources interprets specs as a click on the active slice.
  // (gridX, gridY) are slice-plane coordinates; the engine maps them to the
  // volume per view_axis.
  function setSources(specs: SourceSpec[]) {
    setSources3D(
      specs.map((s) => {
        const [x, y, z] = sliceToVolume(s.x, s.y)
        return {
          x,
          y,
          z,
          phase: s.phase,
          amplitude: s.amplitude,
          polarization: s.polarization,
        }
      }),
    )
  }

  function placeSource(gridX: number, gridY: number) {
    setSources([
      { x: gridX, y: gridY, phase: 0, amplitude: 1, polarization: 'z' },
    ])
  }

  function getSources(): SourceSpec[] {
    return sources.map((s) => ({
      x: s.x,
      y: s.y,
      phase: s.phase,
      amplitude: s.amplitude,
      polarization: s.polarization,
    }))
  }

  function setSourcePeriod(period: number) {
    sourcePeriod = Math.max(4, period)
  }

  function setSourceMode(mode: SourceMode) {
    sourceMode = mode
    if (mode !== 'pulse') pulseT0 = -1
  }

  function setSourceWaveform(waveform: SourceWaveform) {
    sourceWaveform = waveform
  }

  function setModulation(params: Partial<ModulationParams>) {
    if (params.modPeriod !== undefined) modulation.modPeriod = Math.max(4, params.modPeriod)
    if (params.amDepth !== undefined) modulation.amDepth = Math.max(0, Math.min(1, params.amDepth))
    if (params.fmIndex !== undefined) modulation.fmIndex = Math.max(0, params.fmIndex)
    if (params.squareEdge !== undefined) modulation.squareEdge = Math.max(1, params.squareEdge)
  }

  function firePulse() {
    if (sourceMode !== 'pulse') return
    pulseT0 = stepCount + Math.round(sourcePeriod * 0.5)
  }

  function setViewMode(mode: ViewMode) {
    uniformU32[9] = mode === 'magnitude' ? 1 : 0
    writeUniforms()
  }

  function setViewSlice(axis: ViewAxis3D, depth: number) {
    const axisCode = axis === 'xy' ? 0 : axis === 'xz' ? 1 : 2
    uniformU32[7] = axisCode
    const maxDepth = axis === 'xy' ? D : axis === 'xz' ? H : W
    uniformU32[8] = Math.max(0, Math.min(maxDepth - 1, Math.floor(depth)))
    writeUniforms()
  }

  function setProbes3D(specs: ProbeSpec3D[]) {
    probes = specs.slice(0, MAX_PROBES).map((p) => ({
      x: Math.max(0, Math.min(W - 1, Math.floor(p.x))),
      y: Math.max(0, Math.min(H - 1, Math.floor(p.y))),
      z: Math.max(0, Math.min(D - 1, Math.floor(p.z))),
    }))
    new Uint8Array(probesBytes).fill(0)
    for (let i = 0; i < probes.length; i++) {
      const base = i * 4 // vec4<u32> stride
      probesU32[base + 0] = probes[i].x
      probesU32[base + 1] = probes[i].y
      probesU32[base + 2] = probes[i].z
    }
    device.queue.writeBuffer(probesBuffer, 0, probesBytes)
    probeHistoryHead = 0
    probeHistoryShadow.fill(0)
    device.queue.writeBuffer(historyBuffer, 0, new Float32Array(MAX_PROBES * PROBE_HISTORY_LEN))
    uniformU32[10] = probes.length
    uniformU32[11] = 0
    writeUniforms()
  }

  // 2D-shaped setProbes treats (x, y) as slice-plane coords on the active slice.
  function setProbes(specs: ProbeSpec[]) {
    setProbes3D(
      specs.map((p) => {
        const [x, y, z] = sliceToVolume(p.x, p.y)
        return { x, y, z }
      }),
    )
  }

  function getProbeHistory(): ProbeHistorySnapshot {
    return {
      shadow: probeHistoryShadow,
      head: probeHistoryHead,
      historyLen: PROBE_HISTORY_LEN,
      probeCount: probes.length,
    }
  }

  // Paint a disk on the currently active slice. The brush radius is in
  // slice-plane cells; depth is fixed at view_depth on the perpendicular axis.
  // PML cells are protected — material there must stay at vacuum for the
  // absorber to work. PEC encoded as σ = -1 sentinel.
  function paint(gridA: number, gridB: number, brushRadius: number, brush: BrushSpec) {
    const depth = uniformU32[8]
    const [aMax, bMax, depthMax] = sliceFaceDims()
    if (depth < PML_THICKNESS_3D || depth + PML_THICKNESS_3D >= depthMax) return
    const r = Math.max(0, Math.floor(brushRadius))
    const r2 = r * r
    const aMin = Math.max(PML_THICKNESS_3D, gridA - r)
    const aMaxC = Math.min(aMax - PML_THICKNESS_3D - 1, gridA + r)
    const bMin = Math.max(PML_THICKNESS_3D, gridB - r)
    const bMaxC = Math.min(bMax - PML_THICKNESS_3D - 1, gridB + r)
    const er = brush.epsilonR
    const sg = brush.pec ? -1.0 : brush.sigma
    for (let b = bMin; b <= bMaxC; b++) {
      for (let a = aMin; a <= aMaxC; a++) {
        const da = a - gridA
        const db = b - gridB
        if (da * da + db * db <= r2) {
          const [x, y, z] = sliceToVolume(a, b)
          const cell = cellIndex(x, y, z)
          epsSigGrid[2 * cell] = er
          epsSigGrid[2 * cell + 1] = sg
        }
      }
    }
    uploadMaterial()
  }

  function paintRect(x0: number, y0: number, x1: number, y1: number, brush: BrushSpec) {
    const depth = uniformU32[8]
    const [aMax, bMax, depthMax] = sliceFaceDims()
    if (depth < PML_THICKNESS_3D || depth + PML_THICKNESS_3D >= depthMax) return
    const aMin = Math.max(PML_THICKNESS_3D, Math.floor(Math.min(x0, x1)))
    const aMaxC = Math.min(aMax - PML_THICKNESS_3D - 1, Math.floor(Math.max(x0, x1)))
    const bMin = Math.max(PML_THICKNESS_3D, Math.floor(Math.min(y0, y1)))
    const bMaxC = Math.min(bMax - PML_THICKNESS_3D - 1, Math.floor(Math.max(y0, y1)))
    const er = brush.epsilonR
    const sg = brush.pec ? -1.0 : brush.sigma
    for (let b = bMin; b <= bMaxC; b++) {
      for (let a = aMin; a <= aMaxC; a++) {
        const [x, y, z] = sliceToVolume(a, b)
        const cell = cellIndex(x, y, z)
        epsSigGrid[2 * cell] = er
        epsSigGrid[2 * cell + 1] = sg
      }
    }
    uploadMaterial()
  }

  function resetMaterials() {
    for (let i = 0; i < W * H * D; i++) {
      epsSigGrid[2 * i] = 1.0
      epsSigGrid[2 * i + 1] = 0
    }
    uploadMaterial()
  }

  function snapshotMaterials(): MaterialSnapshot {
    return {
      epsSig: new Float32Array(epsSigGrid),
      flags: new Uint32Array(0), // PEC packed into σ sentinel; no separate flag grid
    }
  }

  function restoreMaterials(snapshot: MaterialSnapshot) {
    if (snapshot.epsSig.length !== epsSigGrid.length) return
    epsSigGrid.set(snapshot.epsSig)
    uploadMaterial()
  }

  function resize(_cssWidth: number, _cssHeight: number) {
    // 3D field dims are fixed at engine creation; canvas resize doesn't
    // reallocate. The render pass scales the slice to fit the canvas via
    // the fullscreen triangle / UV mapping in field-render-3d.wgsl.
  }

  function getDims() {
    // GPUCanvas reads getDims() for pointer→cell mapping. Return the face dims
    // of the *currently selected slice* so pointer coordinates map correctly.
    const [aMax, bMax] = sliceFaceDims()
    return { width: aMax, height: bMax }
  }

  function getDims3D() {
    return { width: W, height: H, depth: D }
  }

  function destroy() {
    exBuf.destroy()
    eyBuf.destroy()
    ezBuf.destroy()
    hxBuf.destroy()
    hyBuf.destroy()
    hzBuf.destroy()
    envBuf.destroy()
    psiExBuf.destroy()
    psiEyBuf.destroy()
    psiEzBuf.destroy()
    psiHxBuf.destroy()
    psiHyBuf.destroy()
    psiHzBuf.destroy()
    pmlXBuf.destroy()
    pmlYBuf.destroy()
    pmlZBuf.destroy()
    materialBuffer.destroy()
    probesBuffer.destroy()
    historyBuffer.destroy()
    probeStagingBuffer.destroy()
    sourcesBuffer.destroy()
    uniformBuffer.destroy()
  }

  // Initial uniform write so the first frame has correct dims.
  writeUniforms()

  // Default centered source so toggling to 3D shows *something* without
  // requiring a scene click — mirrors what 2D engines do inside resize().
  setSources3D([
    {
      x: Math.floor(W / 2),
      y: Math.floor(H / 2),
      z: Math.floor(D / 2),
      phase: 0,
      amplitude: 1,
      polarization: 'z',
    },
  ])

  return {
    polarization: '3D',
    resize,
    step,
    destroy,
    paint,
    paintRect,
    resetMaterials,
    resetFields,
    setSources,
    getSources,
    placeSource,
    setSourcePeriod,
    setSourceMode,
    setSourceWaveform,
    setModulation,
    firePulse,
    setViewMode,
    setProbes,
    getProbeHistory,
    snapshotMaterials,
    restoreMaterials,
    getDims,
    pmlThickness: PML_THICKNESS_3D,
    // 3D-specific:
    setSources3D,
    setProbes3D,
    getDims3D,
    setViewSlice,
  }
}
