import { useEffect, useRef, useState } from 'react'
import { initGPU } from '../gpu/init'
import { createDemo, type DemoEngine } from '../gpu/demo'

export default function GPUCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let raf = 0
    let demo: DemoEngine | null = null
    let cancelled = false
    const start = performance.now()

    const parent = canvas.parentElement
    let lastW = 0
    let lastH = 0
    const fit = () => {
      const target = parent ?? canvas
      const w = Math.max(8, target.clientWidth)
      const h = Math.max(8, target.clientHeight)
      if (w !== lastW || h !== lastH) {
        lastW = w
        lastH = h
        const dpr = window.devicePixelRatio || 1
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        canvas.width = Math.max(1, Math.floor(w * dpr))
        canvas.height = Math.max(1, Math.floor(h * dpr))
      }
      demo?.resize(w, h)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (parent) ro.observe(parent)

    initGPU(canvas)
      .then((gpu) => {
        if (cancelled) return
        demo = createDemo(gpu)
        demo.resize(lastW, lastH)

        const tick = () => {
          if (cancelled || !demo) return
          const elapsed = (performance.now() - start) / 1000
          demo.step(elapsed)
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      demo?.destroy()
    }
  }, [])

  if (error) {
    return (
      <div className="error">
        <h3>WebGPU unavailable</h3>
        <p>{error}</p>
      </div>
    )
  }

  return <canvas ref={canvasRef} />
}
