export interface GPUContext {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
  canvas: HTMLCanvasElement
}

export async function initGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error(
      'WebGPU is not supported in this browser. Try Chrome/Edge 113+, Safari 26+, or Firefox with the flag enabled.',
    )
  }

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    throw new Error('No suitable GPU adapter found.')
  }

  const device = await adapter.requestDevice()

  // Surface silent WebGPU validation errors — pipeline creation, bind group
  // mismatches, and buffer-size violations are otherwise invisible without
  // explicit error scopes.
  device.addEventListener('uncapturederror', (event) => {
    const e = event as unknown as { error: { message?: string } }
    console.error('[webgpu]', e.error?.message ?? e.error)
  })
  device.lost.then((info) => {
    console.error('[webgpu] device lost:', info.reason, info.message)
  })

  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new Error('Could not obtain WebGPU canvas context.')
  }

  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  })

  return { device, context, format, canvas }
}
