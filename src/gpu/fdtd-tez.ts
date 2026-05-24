import eShaderSrc from '../shaders/fdtd-e-tez.wgsl?raw'
import hShaderSrc from '../shaders/fdtd-h-tez.wgsl?raw'
import envShaderSrc from '../shaders/envelope-tez.wgsl?raw'
import sourceApplyShaderSrc from '../shaders/source-apply-tez.wgsl?raw'
import probeSampleShaderSrc from '../shaders/probe-sample-tez.wgsl?raw'
import renderShaderSrc from '../shaders/field-render-tez.wgsl?raw'
import type { GPUContext } from './init'
import {
  FLAG_PEC,
  MAX_PROBES,
  MAX_SOURCES,
  PROBE_HISTORY_LEN,
  type BrushSpec,
  type FDTDEngine,
  type MaterialSnapshot,
  type ModulationParams,
  type ProbeHistorySnapshot,
  type ProbeSpec,
  type SourceMode,
  type SourcePolarization,
  type SourceSpec,
  type SourceWaveform,
  type ViewMode,
} from './fdtd'

// Imported constants from fdtd.ts so they stay aligned across engines.
const MAX_FIELD_DIM = 1024
const SC = 1 / Math.SQRT2
const REFERENCE_PERIOD = 80
const STEPS_PER_FRAME = 4

const PML_THICKNESS = 12
const PML_ORDER = 3
const PML_TARGET_R = 1e-6
const SIGMA_MAX =
  (-(PML_ORDER + 1) * Math.log(PML_TARGET_R)) / (2 * PML_THICKNESS)

const DEFAULT_MOD: ModulationParams = {
  modPeriod: 400,
  amDepth: 0.5,
  fmIndex: 2,
  squareEdge: 20,
}

const POL_X: number = 1
const POL_Y: number = 2

function polarizationToU32(p: SourcePolarization | undefined): number {
  if (p === 'x') return POL_X
  // 'y', 'z', or undefined → drive Ey (the default sensible choice for a
  // TMz-authored scene loaded under TEz). See ADR 0009.
  return POL_Y
}

function fieldDimsFromCanvas(w: number, h: number): [number, number] {
  const safeW = Math.max(8, Math.round(w))
  const safeH = Math.max(8, Math.round(h))
  if (safeW <= MAX_FIELD_DIM && safeH <= MAX_FIELD_DIM) return [safeW, safeH]
  if (safeW >= safeH) {
    return [MAX_FIELD_DIM, Math.max(8, Math.round((safeH / safeW) * MAX_FIELD_DIM))]
  }
  return [Math.max(8, Math.round((safeW / safeH) * MAX_FIELD_DIM)), MAX_FIELD_DIM]
}

function sigmaAt(position: number, axisLen: number): number {
  if (position < PML_THICKNESS) {
    const depth = PML_THICKNESS - position
    return SIGMA_MAX * Math.pow(depth / PML_THICKNESS, PML_ORDER)
  }
  if (position > axisLen - 1 - PML_THICKNESS) {
    const depth = position - (axisLen - 1 - PML_THICKNESS)
    return SIGMA_MAX * Math.pow(depth / PML_THICKNESS, PML_ORDER)
  }
  return 0
}

function pmlCoeffs(sigma: number): [number, number] {
  if (sigma < 1e-12) return [1, SC]
  const ca = Math.exp(-sigma * SC)
  return [ca, (1 - ca) / sigma]
}

function buildPMLAxis(len: number): Float32Array {
  const out = new Float32Array(len * 4)
  for (let i = 0; i < len; i++) {
    const [caE, cbE] = pmlCoeffs(sigmaAt(i, len))
    const [caH, cbH] = pmlCoeffs(sigmaAt(i + 0.5, len))
    out[4 * i + 0] = caE
    out[4 * i + 1] = cbE
    out[4 * i + 2] = caH
    out[4 * i + 3] = cbH
  }
  return out
}

export function createFDTD_TEz(gpu: GPUContext): FDTDEngine {
  const { device, context, format } = gpu

  // Same 48-byte uniform layout as TMz — see fdtd.ts for the field map.
  const uniformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformBytes = new ArrayBuffer(48)
  const uniformU32 = new Uint32Array(uniformBytes)
  const uniformF32 = new Float32Array(uniformBytes)
  uniformU32[3] = PML_THICKNESS
  uniformF32[4] = SC
  uniformU32[5] = 0
  uniformU32[8] = PROBE_HISTORY_LEN
  uniformF32[9] = 6.0 // display_gain — overrides via setDisplayGain

  function writeUniforms() {
    device.queue.writeBuffer(uniformBuffer, 0, uniformBytes)
  }

  const sourcesBuffer = device.createBuffer({
    size: MAX_SOURCES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sourcesBytes = new ArrayBuffer(MAX_SOURCES * 16)
  const sourcesU32 = new Uint32Array(sourcesBytes)
  const sourcesF32 = new Float32Array(sourcesBytes)

  const probesBuffer = device.createBuffer({
    size: MAX_PROBES * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const probesBytes = new ArrayBuffer(MAX_PROBES * 8)
  const probesU32 = new Uint32Array(probesBytes)

  const HISTORY_BYTES = MAX_PROBES * PROBE_HISTORY_LEN * 4
  const historyBuffer = device.createBuffer({
    size: HISTORY_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const probeStagingBuffer = device.createBuffer({
    size: HISTORY_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const probeHistoryShadow = new Float32Array(MAX_PROBES * PROBE_HISTORY_LEN)
  type ReadbackState = 'idle' | 'in-flight'
  let probeReadbackState: ReadbackState = 'idle'

  const ePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: eShaderSrc }),
      entryPoint: 'main',
    },
  })
  const hPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: hShaderSrc }),
      entryPoint: 'main',
    },
  })
  const sourceApplyPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: sourceApplyShaderSrc }),
      entryPoint: 'main',
    },
  })
  const envPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: envShaderSrc }),
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

  let exBuffer: GPUBuffer | null = null
  let eyBuffer: GPUBuffer | null = null
  let hzxBuffer: GPUBuffer | null = null
  let hzyBuffer: GPUBuffer | null = null
  let pmlXBuffer: GPUBuffer | null = null
  let pmlYBuffer: GPUBuffer | null = null
  let materialBuffer: GPUBuffer | null = null
  let flagsBuffer: GPUBuffer | null = null
  let envBuffer: GPUBuffer | null = null
  let epsSigGrid: Float32Array | null = null
  let flagsGrid: Uint32Array | null = null
  let eBindGroup: GPUBindGroup | null = null
  let hBindGroup: GPUBindGroup | null = null
  let sourceApplyBindGroup: GPUBindGroup | null = null
  let envBindGroup: GPUBindGroup | null = null
  let probeSampleBindGroup: GPUBindGroup | null = null
  let renderBindGroup: GPUBindGroup | null = null
  let fieldW = 0
  let fieldH = 0
  let stepCount = 0

  let sourcePeriod = REFERENCE_PERIOD
  let sourceMode: SourceMode = 'cw'
  let sourceWaveform: SourceWaveform = 'sine'
  const modulation: ModulationParams = { ...DEFAULT_MOD }
  let pulseT0 = -1
  let sources: SourceSpec[] = []
  let probes: ProbeSpec[] = []
  let probeHistoryHead = 0

  function uploadMaterials() {
    if (!materialBuffer || !flagsBuffer) return
    if (!epsSigGrid || !flagsGrid) return
    device.queue.writeBuffer(materialBuffer, 0, epsSigGrid)
    device.queue.writeBuffer(flagsBuffer, 0, flagsGrid)
  }

  function resize(cssWidth: number, cssHeight: number) {
    const [w, h] = fieldDimsFromCanvas(cssWidth, cssHeight)
    if (w === fieldW && h === fieldH && exBuffer) return

    exBuffer?.destroy()
    eyBuffer?.destroy()
    hzxBuffer?.destroy()
    hzyBuffer?.destroy()
    pmlXBuffer?.destroy()
    pmlYBuffer?.destroy()
    materialBuffer?.destroy()
    flagsBuffer?.destroy()
    envBuffer?.destroy()

    fieldW = w
    fieldH = h
    stepCount = 0
    pulseT0 = -1
    epsSigGrid = new Float32Array(w * h * 2)
    for (let i = 0; i < w * h; i++) epsSigGrid[2 * i] = 1.0
    flagsGrid = new Uint32Array(w * h)

    const fieldBytes = w * h * 4
    const fieldUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    exBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    eyBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    hzxBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    hzyBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    materialBuffer = device.createBuffer({ size: fieldBytes * 2, usage: fieldUsage })
    flagsBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    envBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })

    const pmlX = buildPMLAxis(w)
    const pmlY = buildPMLAxis(h)
    pmlXBuffer = device.createBuffer({
      size: pmlX.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    pmlYBuffer = device.createBuffer({
      size: pmlY.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(pmlXBuffer, 0, pmlX)
    device.queue.writeBuffer(pmlYBuffer, 0, pmlY)

    eBindGroup = device.createBindGroup({
      layout: ePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: exBuffer } },
        { binding: 2, resource: { buffer: eyBuffer } },
        { binding: 3, resource: { buffer: hzxBuffer } },
        { binding: 4, resource: { buffer: hzyBuffer } },
        { binding: 5, resource: { buffer: pmlXBuffer } },
        { binding: 6, resource: { buffer: pmlYBuffer } },
        { binding: 7, resource: { buffer: materialBuffer } },
        { binding: 8, resource: { buffer: flagsBuffer } },
      ],
    })
    hBindGroup = device.createBindGroup({
      layout: hPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: hzxBuffer } },
        { binding: 2, resource: { buffer: hzyBuffer } },
        { binding: 3, resource: { buffer: exBuffer } },
        { binding: 4, resource: { buffer: eyBuffer } },
        { binding: 5, resource: { buffer: pmlXBuffer } },
        { binding: 6, resource: { buffer: pmlYBuffer } },
      ],
    })
    sourceApplyBindGroup = device.createBindGroup({
      layout: sourceApplyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: sourcesBuffer } },
        { binding: 2, resource: { buffer: exBuffer } },
        { binding: 3, resource: { buffer: eyBuffer } },
      ],
    })
    envBindGroup = device.createBindGroup({
      layout: envPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: exBuffer } },
        { binding: 2, resource: { buffer: eyBuffer } },
        { binding: 3, resource: { buffer: envBuffer } },
      ],
    })
    probeSampleBindGroup = device.createBindGroup({
      layout: probeSamplePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: probesBuffer } },
        { binding: 2, resource: { buffer: hzxBuffer } },
        { binding: 3, resource: { buffer: hzyBuffer } },
        { binding: 4, resource: { buffer: historyBuffer } },
      ],
    })
    renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: hzxBuffer } },
        { binding: 2, resource: { buffer: hzyBuffer } },
        { binding: 3, resource: { buffer: materialBuffer } },
        { binding: 4, resource: { buffer: flagsBuffer } },
        { binding: 5, resource: { buffer: envBuffer } },
        { binding: 6, resource: { buffer: sourcesBuffer } },
        { binding: 7, resource: { buffer: probesBuffer } },
      ],
    })

    uniformU32[0] = w
    uniformU32[1] = h
    writeUniforms()
    uploadMaterials()

    sources = [
      { x: Math.floor(w / 2), y: Math.floor(h / 2), phase: 0, amplitude: 1, polarization: 'y' },
    ]
    uniformU32[2] = sources.length
    writeUniforms()
    writeSources()

    probes = []
    probeHistoryHead = 0
    probeHistoryShadow.fill(0)
    uniformU32[6] = 0
    uniformU32[7] = 0
    writeUniforms()
    device.queue.writeBuffer(historyBuffer, 0, new Float32Array(MAX_PROBES * PROBE_HISTORY_LEN))
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

  function evaluateSource(spec: SourceSpec): number {
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
    for (let i = 0; i < n; i++) {
      const s = sources[i]
      sourcesU32[4 * i + 0] = s.x
      sourcesU32[4 * i + 1] = s.y
      sourcesF32[4 * i + 2] = evaluateSource(s)
      sourcesU32[4 * i + 3] = polarizationToU32(s.polarization)
    }
    device.queue.writeBuffer(sourcesBuffer, 0, sourcesBytes)
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
        console.error('probe readback mapAsync failed', err)
        probeReadbackState = 'idle'
      })
  }

  function step() {
    if (
      !eBindGroup ||
      !hBindGroup ||
      !sourceApplyBindGroup ||
      !envBindGroup ||
      !probeSampleBindGroup ||
      !renderBindGroup
    ) {
      return
    }

    const workgroupsX = Math.ceil(fieldW / 8)
    const workgroupsY = Math.ceil(fieldH / 8)

    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      if (sourceMode === 'pulse' && pulseT0 >= 0) {
        const dt = (stepCount - pulseT0) / sourcePeriod
        if (dt > 5) pulseT0 = -1
      }
      uniformU32[7] = probeHistoryHead
      writeUniforms()
      writeSources()

      const encoder = device.createCommandEncoder()

      const hPass = encoder.beginComputePass()
      hPass.setPipeline(hPipeline)
      hPass.setBindGroup(0, hBindGroup)
      hPass.dispatchWorkgroups(workgroupsX, workgroupsY)
      hPass.end()

      const ePass = encoder.beginComputePass()
      ePass.setPipeline(ePipeline)
      ePass.setBindGroup(0, eBindGroup)
      ePass.dispatchWorkgroups(workgroupsX, workgroupsY)
      ePass.end()

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
      envPass.dispatchWorkgroups(workgroupsX, workgroupsY)
      envPass.end()

      if (probes.length > 0) {
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

  function paint(gridX: number, gridY: number, brushRadius: number, brush: BrushSpec) {
    if (!epsSigGrid || !flagsGrid) return
    const W = fieldW
    const H = fieldH
    const r = Math.max(0, Math.floor(brushRadius))
    const r2 = r * r
    const xMin = Math.max(PML_THICKNESS, gridX - r)
    const xMax = Math.min(W - PML_THICKNESS - 1, gridX + r)
    const yMin = Math.max(PML_THICKNESS, gridY - r)
    const yMax = Math.min(H - PML_THICKNESS - 1, gridY + r)
    const er = brush.epsilonR
    const sg = brush.sigma
    const fl = brush.pec ? FLAG_PEC : 0
    for (let j = yMin; j <= yMax; j++) {
      const row = j * W
      for (let i = xMin; i <= xMax; i++) {
        const dx = i - gridX
        const dy = j - gridY
        if (dx * dx + dy * dy <= r2) {
          const k = row + i
          epsSigGrid[2 * k] = er
          epsSigGrid[2 * k + 1] = sg
          flagsGrid[k] = fl
        }
      }
    }
    uploadMaterials()
  }

  function paintRect(x0: number, y0: number, x1: number, y1: number, brush: BrushSpec) {
    if (!epsSigGrid || !flagsGrid) return
    const W = fieldW
    const xMin = Math.max(PML_THICKNESS, Math.floor(Math.min(x0, x1)))
    const xMax = Math.min(W - PML_THICKNESS - 1, Math.floor(Math.max(x0, x1)))
    const yMin = Math.max(PML_THICKNESS, Math.floor(Math.min(y0, y1)))
    const yMax = Math.min(fieldH - PML_THICKNESS - 1, Math.floor(Math.max(y0, y1)))
    const er = brush.epsilonR
    const sg = brush.sigma
    const fl = brush.pec ? FLAG_PEC : 0
    for (let j = yMin; j <= yMax; j++) {
      const row = j * W
      for (let i = xMin; i <= xMax; i++) {
        const k = row + i
        epsSigGrid[2 * k] = er
        epsSigGrid[2 * k + 1] = sg
        flagsGrid[k] = fl
      }
    }
    uploadMaterials()
  }

  function resetMaterials() {
    if (!epsSigGrid || !flagsGrid) return
    const cells = fieldW * fieldH
    for (let k = 0; k < cells; k++) {
      epsSigGrid[2 * k] = 1.0
      epsSigGrid[2 * k + 1] = 0
    }
    flagsGrid.fill(0)
    uploadMaterials()
  }

  function resetFields() {
    if (!exBuffer || !eyBuffer || !hzxBuffer || !hzyBuffer || !envBuffer) return
    const zeros = new Float32Array(fieldW * fieldH)
    device.queue.writeBuffer(exBuffer, 0, zeros)
    device.queue.writeBuffer(eyBuffer, 0, zeros)
    device.queue.writeBuffer(hzxBuffer, 0, zeros)
    device.queue.writeBuffer(hzyBuffer, 0, zeros)
    device.queue.writeBuffer(envBuffer, 0, zeros)
    stepCount = 0
    pulseT0 = -1
  }

  function setSources(specs: SourceSpec[]) {
    sources = specs.slice(0, MAX_SOURCES).map((s) => ({
      x: Math.max(0, Math.min(fieldW - 1, Math.floor(s.x))),
      y: Math.max(0, Math.min(fieldH - 1, Math.floor(s.y))),
      phase: s.phase,
      amplitude: s.amplitude,
      polarization: s.polarization,
    }))
    uniformU32[2] = sources.length
    writeUniforms()
    writeSources()
  }

  function getSources(): SourceSpec[] {
    return sources.map((s) => ({ ...s }))
  }

  function placeSource(gridX: number, gridY: number) {
    setSources([{ x: gridX, y: gridY, phase: 0, amplitude: 1, polarization: 'y' }])
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
    // 2D has no 'volume' — fall back to the signed view.
    uniformU32[5] = mode === 'magnitude' ? 1 : 0
    writeUniforms()
  }

  function setDisplayGain(g: number) {
    uniformF32[9] = Math.max(0.1, g)
    writeUniforms()
  }

  function setProbes(specs: ProbeSpec[]) {
    probes = specs.slice(0, MAX_PROBES).map((p) => ({
      x: Math.max(0, Math.min(fieldW - 1, Math.floor(p.x))),
      y: Math.max(0, Math.min(fieldH - 1, Math.floor(p.y))),
    }))
    new Uint8Array(probesBytes).fill(0)
    for (let i = 0; i < probes.length; i++) {
      probesU32[2 * i + 0] = probes[i].x
      probesU32[2 * i + 1] = probes[i].y
    }
    device.queue.writeBuffer(probesBuffer, 0, probesBytes)
    probeHistoryHead = 0
    probeHistoryShadow.fill(0)
    device.queue.writeBuffer(historyBuffer, 0, new Float32Array(MAX_PROBES * PROBE_HISTORY_LEN))
    uniformU32[6] = probes.length
    uniformU32[7] = 0
    writeUniforms()
  }

  function getProbeHistory(): ProbeHistorySnapshot {
    return {
      shadow: probeHistoryShadow,
      head: probeHistoryHead,
      historyLen: PROBE_HISTORY_LEN,
      probeCount: probes.length,
    }
  }

  function snapshotMaterials(): MaterialSnapshot {
    if (!epsSigGrid || !flagsGrid) {
      return {
        epsSig: new Float32Array(0),
        flags: new Uint32Array(0),
      }
    }
    return {
      epsSig: new Float32Array(epsSigGrid),
      flags: new Uint32Array(flagsGrid),
    }
  }

  function restoreMaterials(snapshot: MaterialSnapshot) {
    if (!epsSigGrid || !flagsGrid) return
    if (snapshot.epsSig.length !== epsSigGrid.length) return
    epsSigGrid.set(snapshot.epsSig)
    flagsGrid.set(snapshot.flags)
    uploadMaterials()
  }

  function getDims() {
    return { width: fieldW, height: fieldH }
  }

  function destroy() {
    exBuffer?.destroy()
    eyBuffer?.destroy()
    hzxBuffer?.destroy()
    hzyBuffer?.destroy()
    pmlXBuffer?.destroy()
    pmlYBuffer?.destroy()
    materialBuffer?.destroy()
    flagsBuffer?.destroy()
    envBuffer?.destroy()
    sourcesBuffer.destroy()
    probesBuffer.destroy()
    historyBuffer.destroy()
    probeStagingBuffer.destroy()
    uniformBuffer.destroy()
  }

  return {
    polarization: 'TEz',
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
    setDisplayGain,
    setProbes,
    getProbeHistory,
    snapshotMaterials,
    restoreMaterials,
    getDims,
    pmlThickness: PML_THICKNESS,
  }
}
