import eShaderSrc from '../shaders/fdtd-e.wgsl?raw'
import hShaderSrc from '../shaders/fdtd-h.wgsl?raw'
import renderShaderSrc from '../shaders/field-render.wgsl?raw'
import type { GPUContext } from './init'

const MAX_FIELD_DIM = 1024
const SC = 1 / Math.SQRT2
const SOURCE_PERIOD = 80
const STEPS_PER_FRAME = 4

// Berenger split-field PML — see M3 ADR notes.
const PML_THICKNESS = 12
const PML_ORDER = 3
const PML_TARGET_R = 1e-6
const SIGMA_MAX =
  (-(PML_ORDER + 1) * Math.log(PML_TARGET_R)) / (2 * PML_THICKNESS)

// Material parameters — see shader for use.
const LOSSY_SIGMA = 1.0
const DIELECTRIC_ER = 4.0

// Material codes — kept in sync with shaders.
export const MAT_VACUUM = 0
export const MAT_PEC = 1
export const MAT_LOSSY = 2
export const MAT_DIELECTRIC = 3

export interface FDTDEngine {
  resize: (cssWidth: number, cssHeight: number) => void
  step: () => void
  destroy: () => void
  paint: (gridX: number, gridY: number, brushRadius: number, material: number) => void
  clearMaterials: () => void
  snapshotMaterials: () => Uint32Array
  restoreMaterials: (snapshot: Uint32Array) => void
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

  // Uniforms layout (40 bytes content, 64 allocated):
  //   0: size:vec2<u32>         (W, H)
  //   8: source:vec2<u32>       (sx, sy)
  //  16: source_value:f32
  //  20: sc:f32
  //  24: lossy_sigma:f32
  //  28: dielectric_er:f32
  //  32: pml_thickness:u32
  //  36: _pad:u32
  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformBytes = new ArrayBuffer(64)
  const uniformU32 = new Uint32Array(uniformBytes)
  const uniformF32 = new Float32Array(uniformBytes)
  uniformF32[5] = SC
  uniformF32[6] = LOSSY_SIGMA
  uniformF32[7] = DIELECTRIC_ER
  uniformU32[8] = PML_THICKNESS

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
  let materialGrid: Uint32Array | null = null
  let eBindGroup: GPUBindGroup | null = null
  let hBindGroup: GPUBindGroup | null = null
  let renderBindGroup: GPUBindGroup | null = null
  let fieldW = 0
  let fieldH = 0
  let stepCount = 0

  function uploadMaterials() {
    if (materialBuffer && materialGrid) {
      device.queue.writeBuffer(materialBuffer, 0, materialGrid)
    }
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

    fieldW = w
    fieldH = h
    stepCount = 0
    materialGrid = new Uint32Array(w * h)

    const fieldBytes = w * h * 4
    const fieldUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    ezxBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    ezyBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    hxBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    hyBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })
    materialBuffer = device.createBuffer({ size: fieldBytes, usage: fieldUsage })

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
    renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: ezxBuffer } },
        { binding: 2, resource: { buffer: ezyBuffer } },
        { binding: 2 + 1, resource: { buffer: materialBuffer } },
      ],
    })

    uniformU32[0] = w
    uniformU32[1] = h
    uniformU32[2] = Math.floor(w / 2)
    uniformU32[3] = Math.floor(h / 2)
    uploadMaterials()
  }

  function step() {
    if (!eBindGroup || !hBindGroup || !renderBindGroup) return

    const workgroupsX = Math.ceil(fieldW / 8)
    const workgroupsY = Math.ceil(fieldH / 8)

    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      uniformF32[4] = Math.sin((2 * Math.PI * stepCount) / SOURCE_PERIOD)
      device.queue.writeBuffer(uniformBuffer, 0, uniformBytes)

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

  function paint(gridX: number, gridY: number, brushRadius: number, material: number) {
    if (!materialGrid) return
    const W = fieldW
    const H = fieldH
    const r = Math.max(0, Math.floor(brushRadius))
    const r2 = r * r
    const xMin = Math.max(PML_THICKNESS, gridX - r)
    const xMax = Math.min(W - PML_THICKNESS - 1, gridX + r)
    const yMin = Math.max(PML_THICKNESS, gridY - r)
    const yMax = Math.min(H - PML_THICKNESS - 1, gridY + r)
    for (let j = yMin; j <= yMax; j++) {
      for (let i = xMin; i <= xMax; i++) {
        const dx = i - gridX
        const dy = j - gridY
        if (dx * dx + dy * dy <= r2) {
          materialGrid[j * W + i] = material
        }
      }
    }
    uploadMaterials()
  }

  function clearMaterials() {
    if (!materialGrid) return
    materialGrid.fill(0)
    uploadMaterials()
  }

  function snapshotMaterials(): Uint32Array {
    if (!materialGrid) return new Uint32Array(0)
    return new Uint32Array(materialGrid)
  }

  function restoreMaterials(snapshot: Uint32Array) {
    if (!materialGrid || snapshot.length !== materialGrid.length) return
    materialGrid.set(snapshot)
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
    uniformBuffer.destroy()
  }

  return {
    resize,
    step,
    destroy,
    paint,
    clearMaterials,
    snapshotMaterials,
    restoreMaterials,
    getDims,
    pmlThickness: PML_THICKNESS,
  }
}
