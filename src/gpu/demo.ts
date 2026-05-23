import computeShaderSrc from '../shaders/demo.compute.wgsl?raw'
import renderShaderSrc from '../shaders/demo.render.wgsl?raw'
import type { GPUContext } from './init'

// Cap the longer field-texture edge to keep compute work bounded on any window size.
const MAX_FIELD_DIM = 1024

export interface DemoEngine {
  resize: (cssWidth: number, cssHeight: number) => void
  step: (elapsedSeconds: number) => void
  destroy: () => void
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

export function createDemo(gpu: GPUContext): DemoEngine {
  const { device, context, format } = gpu

  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformBytes = new ArrayBuffer(16)
  const uniformF32 = new Float32Array(uniformBytes)
  const uniformU32 = new Uint32Array(uniformBytes)

  const computeModule = device.createShaderModule({ code: computeShaderSrc })
  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: computeModule, entryPoint: 'main' },
  })

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
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

  let fieldTexture: GPUTexture | null = null
  let computeBindGroup: GPUBindGroup | null = null
  let renderBindGroup: GPUBindGroup | null = null
  let fieldW = 0
  let fieldH = 0

  function resize(cssWidth: number, cssHeight: number) {
    const [w, h] = fieldDimsFromCanvas(cssWidth, cssHeight)
    if (w === fieldW && h === fieldH && fieldTexture) return

    fieldTexture?.destroy()
    fieldW = w
    fieldH = h

    fieldTexture = device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    const fieldView = fieldTexture.createView()

    computeBindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: fieldView },
      ],
    })
    renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: fieldView },
        { binding: 1, resource: sampler },
      ],
    })

    uniformU32[2] = w
    uniformU32[3] = h
  }

  function step(elapsedSeconds: number) {
    if (!computeBindGroup || !renderBindGroup) return

    uniformF32[0] = elapsedSeconds
    device.queue.writeBuffer(uniformBuffer, 0, uniformBytes)

    const encoder = device.createCommandEncoder()

    const computePass = encoder.beginComputePass()
    computePass.setPipeline(computePipeline)
    computePass.setBindGroup(0, computeBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(fieldW / 8), Math.ceil(fieldH / 8))
    computePass.end()

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

  function destroy() {
    fieldTexture?.destroy()
    uniformBuffer.destroy()
  }

  return { resize, step, destroy }
}
