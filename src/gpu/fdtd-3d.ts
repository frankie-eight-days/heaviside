import exShaderSrc from '../shaders/fdtd-ex-3d.wgsl?raw'
import eyShaderSrc from '../shaders/fdtd-ey-3d.wgsl?raw'
import ezShaderSrc from '../shaders/fdtd-ez-3d.wgsl?raw'
import hxShaderSrc from '../shaders/fdtd-hx-3d.wgsl?raw'
import hyShaderSrc from '../shaders/fdtd-hy-3d.wgsl?raw'
import hzShaderSrc from '../shaders/fdtd-hz-3d.wgsl?raw'
import sourceApplyShaderSrc from '../shaders/source-apply-3d.wgsl?raw'
import renderShaderSrc from '../shaders/field-render-3d.wgsl?raw'
import type { GPUContext } from './init'
import {
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

// Default 128³ for M9a smoke tests — fits easily in any GPU and ~6× faster
// to alloc/clear than 256³. ADR 0010 calls for 256³ as the "user-facing"
// default; we'll surface a resolution control in M9d.
const DEFAULT_DIM = 128

const SOURCE_STRIDE_BYTES = 32

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
  uniformU32[5] = 0 // pml_thickness (M9b)
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

  // Sources buffer — 32 B/source (vec3 pos + pol + value + 12 B pad).
  const sourcesBuffer = device.createBuffer({
    size: MAX_SOURCES * SOURCE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sourcesBytes = new ArrayBuffer(MAX_SOURCES * SOURCE_STRIDE_BYTES)
  const sourcesU32 = new Uint32Array(sourcesBytes)
  const sourcesF32 = new Float32Array(sourcesBytes)

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

  // Bind groups.
  const exBindGroup = device.createBindGroup({
    layout: exPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: exBuf } },
      { binding: 2, resource: { buffer: hzBuf } },
      { binding: 3, resource: { buffer: hyBuf } },
    ],
  })
  const eyBindGroup = device.createBindGroup({
    layout: eyPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: eyBuf } },
      { binding: 2, resource: { buffer: hxBuf } },
      { binding: 3, resource: { buffer: hzBuf } },
    ],
  })
  const ezBindGroup = device.createBindGroup({
    layout: ezPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: ezBuf } },
      { binding: 2, resource: { buffer: hyBuf } },
      { binding: 3, resource: { buffer: hxBuf } },
    ],
  })
  const hxBindGroup = device.createBindGroup({
    layout: hxPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hxBuf } },
      { binding: 2, resource: { buffer: eyBuf } },
      { binding: 3, resource: { buffer: ezBuf } },
    ],
  })
  const hyBindGroup = device.createBindGroup({
    layout: hyPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hyBuf } },
      { binding: 2, resource: { buffer: ezBuf } },
      { binding: 3, resource: { buffer: exBuf } },
    ],
  })
  const hzBindGroup = device.createBindGroup({
    layout: hzPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hzBuf } },
      { binding: 2, resource: { buffer: exBuf } },
      { binding: 3, resource: { buffer: eyBuf } },
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
  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: ezBuf } },
    ],
  })

  let stepCount = 0
  let sourcePeriod = REFERENCE_PERIOD
  let sourceMode: SourceMode = 'cw'
  let sourceWaveform: SourceWaveform = 'sine'
  const modulation: ModulationParams = { ...DEFAULT_MOD }
  let pulseT0 = -1
  let sources: SourceSpec3D[] = []

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

      device.queue.submit([encoder.finish()])
      stepCount++
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
  }

  function resetFields() {
    const zeros = new Float32Array(W * H * D)
    device.queue.writeBuffer(exBuf, 0, zeros)
    device.queue.writeBuffer(eyBuf, 0, zeros)
    device.queue.writeBuffer(ezBuf, 0, zeros)
    device.queue.writeBuffer(hxBuf, 0, zeros)
    device.queue.writeBuffer(hyBuf, 0, zeros)
    device.queue.writeBuffer(hzBuf, 0, zeros)
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

  // 2D-shaped setSources interprets specs as XY at the current view depth.
  function setSources(specs: SourceSpec[]) {
    setSources3D(
      specs.map((s) => ({
        x: s.x,
        y: s.y,
        z: uniformU32[8],
        phase: s.phase,
        amplitude: s.amplitude,
        polarization: s.polarization,
      })),
    )
  }

  function placeSource(gridX: number, gridY: number) {
    setSources3D([
      {
        x: gridX,
        y: gridY,
        z: uniformU32[8],
        phase: 0,
        amplitude: 1,
        polarization: 'z',
      },
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

  function setViewMode(_mode: ViewMode) {
    // M9c will add the magnitude envelope; for M9a only signed Ez exists.
  }

  function setViewSlice(axis: ViewAxis3D, depth: number) {
    const axisCode = axis === 'xy' ? 0 : axis === 'xz' ? 1 : 2
    uniformU32[7] = axisCode
    const maxDepth = axis === 'xy' ? D : axis === 'xz' ? H : W
    uniformU32[8] = Math.max(0, Math.min(maxDepth - 1, Math.floor(depth)))
    writeUniforms()
  }

  // 2D probe primitive — M9c implements 3D probes; this maps to (x, y, midplane).
  function setProbes(_specs: ProbeSpec[]) {
    // no-op until M9c
  }

  function setProbes3D(_specs: ProbeSpec3D[]) {
    // no-op until M9c
  }

  function getProbeHistory(): ProbeHistorySnapshot {
    return {
      shadow: new Float32Array(0),
      head: 0,
      historyLen: PROBE_HISTORY_LEN,
      probeCount: 0,
    }
  }

  // Material grid not yet implemented — M9c.
  function paint(_x: number, _y: number, _r: number, _brush: BrushSpec) {}
  function paintRect(_x0: number, _y0: number, _x1: number, _y1: number, _brush: BrushSpec) {}
  function resetMaterials() {}
  function snapshotMaterials(): MaterialSnapshot {
    return { epsSig: new Float32Array(0), flags: new Uint32Array(0) }
  }
  function restoreMaterials(_snapshot: MaterialSnapshot) {}

  function resize(_cssWidth: number, _cssHeight: number) {
    // 3D field dims are fixed at engine creation; canvas resize doesn't
    // reallocate. The render pass scales the slice to fit the canvas via
    // the fullscreen triangle / UV mapping in field-render-3d.wgsl.
  }

  function getDims() {
    // GPUCanvas reads getDims() for pointer→cell mapping. Return the XY face
    // dims (W, H) — the slice the user is interacting with in the default
    // XY view. Pointer hits at the active slice depth z = uniformU32[8].
    return { width: W, height: H }
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
    sourcesBuffer.destroy()
    uniformBuffer.destroy()
  }

  // Initial uniform write so the first frame has correct dims.
  writeUniforms()

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
    pmlThickness: 0, // M9b
    // 3D-specific:
    setSources3D,
    setProbes3D,
    getDims3D,
    setViewSlice,
  }
}
