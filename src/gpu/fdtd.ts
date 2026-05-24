import eShaderSrc from '../shaders/fdtd-e.wgsl?raw'
import hShaderSrc from '../shaders/fdtd-h.wgsl?raw'
import envShaderSrc from '../shaders/envelope.wgsl?raw'
import sourceApplyShaderSrc from '../shaders/source-apply.wgsl?raw'
import renderShaderSrc from '../shaders/field-render.wgsl?raw'
import type { GPUContext } from './init'

const MAX_FIELD_DIM = 1024
const SC = 1 / Math.SQRT2

// Reference period for the Df→σ conversion. See ADR 0003.
const REFERENCE_PERIOD = 80

const STEPS_PER_FRAME = 4

// Maximum number of simultaneous sources. Drives the sources storage buffer
// size and the source-apply workgroup count. See ADR 0006. 128 lets the PCB
// scenes use port columns spanning a substrate gap without silent clamping.
export const MAX_SOURCES = 128

export function dfToSigma(dk: number, df: number): number {
  return ((2 * Math.PI) / REFERENCE_PERIOD) * dk * df / SC
}

// Berenger split-field PML — see ADR M3 notes.
const PML_THICKNESS = 12
const PML_ORDER = 3
const PML_TARGET_R = 1e-6
const SIGMA_MAX =
  (-(PML_ORDER + 1) * Math.log(PML_TARGET_R)) / (2 * PML_THICKNESS)

export const FLAG_PEC = 1

export type SourceMode = 'off' | 'cw' | 'pulse'
export type ViewMode = 'ez' | 'magnitude'

export interface SourceSpec {
  x: number
  y: number
  phase: number
  amplitude: number
}

export interface BrushSpec {
  epsilonR: number
  sigma: number
  pec: boolean
}

export interface MaterialSnapshot {
  epsSig: Float32Array
  flags: Uint32Array
}

export interface FDTDEngine {
  resize: (cssWidth: number, cssHeight: number) => void
  step: () => void
  destroy: () => void
  paint: (gridX: number, gridY: number, brushRadius: number, brush: BrushSpec) => void
  paintRect: (x0: number, y0: number, x1: number, y1: number, brush: BrushSpec) => void
  resetMaterials: () => void
  resetFields: () => void
  setSources: (sources: SourceSpec[]) => void
  placeSource: (gridX: number, gridY: number) => void
  setSourcePeriod: (period: number) => void
  setSourceMode: (mode: SourceMode) => void
  firePulse: () => void
  setViewMode: (mode: ViewMode) => void
  snapshotMaterials: () => MaterialSnapshot
  restoreMaterials: (snapshot: MaterialSnapshot) => void
  getDims: () => { width: number; height: number }
  pmlThickness: number
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

export function createFDTD(gpu: GPUContext): FDTDEngine {
  const { device, context, format } = gpu

  // Uniforms layout (32 bytes) — must match the WGSL struct in every shader.
  //   0: size: vec2<u32>           (W, H)
  //   8: source_count: u32
  //  12: pml_thickness: u32
  //  16: sc: f32
  //  20: view_mode: u32
  //  24: _pad: vec2<u32>
  const uniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformBytes = new ArrayBuffer(32)
  const uniformU32 = new Uint32Array(uniformBytes)
  const uniformF32 = new Float32Array(uniformBytes)
  uniformU32[3] = PML_THICKNESS
  uniformF32[4] = SC
  uniformU32[5] = 0 // view_mode = Ez by default

  function writeUniforms() {
    device.queue.writeBuffer(uniformBuffer, 0, uniformBytes)
  }

  // Sources buffer: MAX_SOURCES × 16 bytes. Allocated once, never resized.
  const sourcesBuffer = device.createBuffer({
    size: MAX_SOURCES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sourcesBytes = new ArrayBuffer(MAX_SOURCES * 16)
  const sourcesU32 = new Uint32Array(sourcesBytes)
  const sourcesF32 = new Float32Array(sourcesBytes)

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

  let ezxBuffer: GPUBuffer | null = null
  let ezyBuffer: GPUBuffer | null = null
  let hxBuffer: GPUBuffer | null = null
  let hyBuffer: GPUBuffer | null = null
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
  let renderBindGroup: GPUBindGroup | null = null
  let fieldW = 0
  let fieldH = 0
  let stepCount = 0

  let sourcePeriod = REFERENCE_PERIOD
  let sourceMode: SourceMode = 'cw'
  let pulseT0 = -1
  let sources: SourceSpec[] = []

  function uploadMaterials() {
    if (!materialBuffer || !flagsBuffer) return
    if (!epsSigGrid || !flagsGrid) return
    device.queue.writeBuffer(materialBuffer, 0, epsSigGrid)
    device.queue.writeBuffer(flagsBuffer, 0, flagsGrid)
  }

  function resize(cssWidth: number, cssHeight: number) {
    const [w, h] = fieldDimsFromCanvas(cssWidth, cssHeight)
    if (w === fieldW && h === fieldH && ezxBuffer) return

    ezxBuffer?.destroy()
    ezyBuffer?.destroy()
    hxBuffer?.destroy()
    hyBuffer?.destroy()
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
    ezxBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    ezyBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    hxBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    hyBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
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
        { binding: 1, resource: { buffer: ezxBuffer } },
        { binding: 2, resource: { buffer: ezyBuffer } },
        { binding: 3, resource: { buffer: hxBuffer } },
        { binding: 4, resource: { buffer: hyBuffer } },
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
        { binding: 1, resource: { buffer: ezxBuffer } },
        { binding: 2, resource: { buffer: ezyBuffer } },
        { binding: 3, resource: { buffer: hxBuffer } },
        { binding: 4, resource: { buffer: hyBuffer } },
        { binding: 5, resource: { buffer: pmlXBuffer } },
        { binding: 6, resource: { buffer: pmlYBuffer } },
      ],
    })
    sourceApplyBindGroup = device.createBindGroup({
      layout: sourceApplyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: sourcesBuffer } },
        { binding: 2, resource: { buffer: ezxBuffer } },
        { binding: 3, resource: { buffer: ezyBuffer } },
      ],
    })
    envBindGroup = device.createBindGroup({
      layout: envPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: ezxBuffer } },
        { binding: 2, resource: { buffer: ezyBuffer } },
        { binding: 3, resource: { buffer: envBuffer } },
      ],
    })
    renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: ezxBuffer } },
        { binding: 2, resource: { buffer: ezyBuffer } },
        { binding: 3, resource: { buffer: materialBuffer } },
        { binding: 4, resource: { buffer: flagsBuffer } },
        { binding: 5, resource: { buffer: envBuffer } },
        { binding: 6, resource: { buffer: sourcesBuffer } },
      ],
    })

    uniformU32[0] = w
    uniformU32[1] = h
    writeUniforms()
    uploadMaterials()

    // Default scene: one CW source at center, matching the M5a out-of-box feel.
    sources = [{ x: Math.floor(w / 2), y: Math.floor(h / 2), phase: 0, amplitude: 1 }]
    uniformU32[2] = sources.length
    writeUniforms()
  }

  function evaluateSource(spec: SourceSpec): number {
    if (sourceMode === 'off') return 0
    const phase = (2 * Math.PI * stepCount) / sourcePeriod + spec.phase
    const carrier = Math.sin(phase) * spec.amplitude
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
    }
    device.queue.writeBuffer(sourcesBuffer, 0, sourcesBytes)
  }

  function step() {
    if (
      !eBindGroup ||
      !hBindGroup ||
      !sourceApplyBindGroup ||
      !envBindGroup ||
      !renderBindGroup
    ) {
      return
    }

    const workgroupsX = Math.ceil(fieldW / 8)
    const workgroupsY = Math.ceil(fieldH / 8)

    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      // Auto-retire a finished pulse so the next Fire is clean.
      if (sourceMode === 'pulse' && pulseT0 >= 0) {
        const dt = (stepCount - pulseT0) / sourcePeriod
        if (dt > 5) pulseT0 = -1
      }
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
    if (!ezxBuffer || !ezyBuffer || !hxBuffer || !hyBuffer || !envBuffer) return
    const zeros = new Float32Array(fieldW * fieldH)
    device.queue.writeBuffer(ezxBuffer, 0, zeros)
    device.queue.writeBuffer(ezyBuffer, 0, zeros)
    device.queue.writeBuffer(hxBuffer, 0, zeros)
    device.queue.writeBuffer(hyBuffer, 0, zeros)
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
    }))
    uniformU32[2] = sources.length
    writeUniforms()
    writeSources()
  }

  function placeSource(gridX: number, gridY: number) {
    setSources([{ x: gridX, y: gridY, phase: 0, amplitude: 1 }])
  }

  function setSourcePeriod(period: number) {
    sourcePeriod = Math.max(4, period)
  }

  function setSourceMode(mode: SourceMode) {
    sourceMode = mode
    if (mode !== 'pulse') pulseT0 = -1
  }

  function firePulse() {
    if (sourceMode !== 'pulse') return
    pulseT0 = stepCount + Math.round(sourcePeriod * 0.5)
  }

  function setViewMode(mode: ViewMode) {
    uniformU32[5] = mode === 'magnitude' ? 1 : 0
    writeUniforms()
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
    ezxBuffer?.destroy()
    ezyBuffer?.destroy()
    hxBuffer?.destroy()
    hyBuffer?.destroy()
    pmlXBuffer?.destroy()
    pmlYBuffer?.destroy()
    materialBuffer?.destroy()
    flagsBuffer?.destroy()
    envBuffer?.destroy()
    sourcesBuffer.destroy()
    uniformBuffer.destroy()
  }

  return {
    resize,
    step,
    destroy,
    paint,
    paintRect,
    resetMaterials,
    resetFields,
    setSources,
    placeSource,
    setSourcePeriod,
    setSourceMode,
    firePulse,
    setViewMode,
    snapshotMaterials,
    restoreMaterials,
    getDims,
    pmlThickness: PML_THICKNESS,
  }
}
