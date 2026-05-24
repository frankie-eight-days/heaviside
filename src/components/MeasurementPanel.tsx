import { useEffect, useRef, useState } from 'react'
import type { GPUCanvasHandle } from './GPUCanvas'
import type { ProbeHistorySnapshot, ProbeSpec } from '../gpu/fdtd'
import { fftReal, hannWindow } from '../lib/fft'

const PROBE_COLORS = [
  '#67c1ff',
  '#9ce066',
  '#ff6ba8',
  '#ffaa44',
  '#ffeb55',
  '#bb88ff',
  '#bbeb55',
  '#ddddee',
]

function probeColor(index: number): string {
  return PROBE_COLORS[index % PROBE_COLORS.length]
}

type DisplayMode = 'single' | 'overlay'
type SpectrumScale = 'linear' | 'db'

interface ProbeMetrics {
  peak: number
  rms: number
  phaseDeg: number
}

interface MeasurementPanelProps {
  probes: ProbeSpec[]
  sourcePeriod: number
  canvasHandle: React.RefObject<GPUCanvasHandle | null>
  onRemoveProbe: (index: number) => void
  onClearProbes: () => void
}

const METRICS_UPDATE_INTERVAL_MS = 100

export default function MeasurementPanel({
  probes,
  sourcePeriod,
  canvasHandle,
  onRemoveProbe,
  onClearProbes,
}: MeasurementPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('single')
  const [spectrumScale, setSpectrumScale] = useState<SpectrumScale>('linear')
  const [metrics, setMetrics] = useState<ProbeMetrics[]>([])
  const timeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sourcePeriodRef = useRef(sourcePeriod)
  const selectedIndexRef = useRef(selectedIndex)
  const displayModeRef = useRef(displayMode)
  const spectrumScaleRef = useRef(spectrumScale)
  useEffect(() => {
    sourcePeriodRef.current = sourcePeriod
  }, [sourcePeriod])
  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])
  useEffect(() => {
    displayModeRef.current = displayMode
  }, [displayMode])
  useEffect(() => {
    spectrumScaleRef.current = spectrumScale
  }, [spectrumScale])

  useEffect(() => {
    if (probes.length === 0) return
    if (selectedIndex >= probes.length) setSelectedIndex(probes.length - 1)
  }, [probes.length, selectedIndex])

  useEffect(() => {
    let raf = 0
    let cancelled = false
    let lastMetricsUpdate = 0

    const tick = (timestamp: number) => {
      if (cancelled) return
      const snap = canvasHandle.current?.getProbeHistory()
      if (snap && snap.probeCount > 0) {
        const allSamples: Float32Array[] = []
        for (let p = 0; p < snap.probeCount; p++) {
          allSamples.push(extractChronological(snap, p))
        }
        const globalPeak = computeGlobalPeak(snap)
        const sel = Math.min(selectedIndexRef.current, snap.probeCount - 1)
        drawTimeSeries(
          timeCanvasRef.current,
          allSamples,
          sel,
          displayModeRef.current,
          globalPeak,
        )
        drawSpectrum(
          spectrumCanvasRef.current,
          allSamples,
          sel,
          displayModeRef.current,
          sourcePeriodRef.current,
          spectrumScaleRef.current,
        )

        if (timestamp - lastMetricsUpdate > METRICS_UPDATE_INTERVAL_MS) {
          lastMetricsUpdate = timestamp
          setMetrics(computeAllMetrics(snap, sourcePeriodRef.current))
        }
      } else {
        clearPlot(timeCanvasRef.current)
        clearPlot(spectrumCanvasRef.current)
        if (timestamp - lastMetricsUpdate > METRICS_UPDATE_INTERVAL_MS) {
          lastMetricsUpdate = timestamp
          setMetrics([])
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [canvasHandle])

  const vswrInfo = computeVSWR(metrics)

  return (
    <aside className="measurement-panel">
      <div className="measurement-header">Measurements</div>

      {probes.length === 0 ? (
        <p className="measurement-empty">
          Pick the <strong>Probe</strong> tool and click on the canvas to drop a
          probe. <strong>Click-drag</strong> to drop a line of probes along a
          transmission line (great for VSWR).
        </p>
      ) : (
        <>
          {vswrInfo && (
            <div className="vswr-panel" title="Voltage Standing Wave Ratio across all probes. Drop probes along a transmission line for this to be meaningful.">
              <div className="vswr-row">
                <span className="vswr-label">VSWR</span>
                <span className="vswr-value">{formatVSWR(vswrInfo.vswr)}</span>
              </div>
              <div className="vswr-row">
                <span className="vswr-label">|Γ|</span>
                <span className="vswr-value">{vswrInfo.gamma.toFixed(3)}</span>
              </div>
              <div className="vswr-row">
                <span className="vswr-label">Return loss</span>
                <span className="vswr-value">
                  {isFinite(vswrInfo.returnLoss)
                    ? `${vswrInfo.returnLoss.toFixed(1)} dB`
                    : '∞ dB'}
                </span>
              </div>
            </div>
          )}

          <div className="probe-list-header">
            <span>{probes.length} probe{probes.length === 1 ? '' : 's'}</span>
            <button type="button" className="link-btn" onClick={onClearProbes}>
              Clear all
            </button>
          </div>
          <ul className="probe-list">
            {probes.map((p, i) => {
              const m = metrics[i]
              return (
                <li key={i} className="probe-row">
                  <button
                    type="button"
                    className={
                      'probe-item' + (selectedIndex === i ? ' probe-item--active' : '')
                    }
                    onClick={() => setSelectedIndex(i)}
                  >
                    <span
                      className="probe-swatch"
                      style={{ background: probeColor(i) }}
                    />
                    <div className="probe-info">
                      <div className="probe-info-line">
                        <span className="probe-label">P{i + 1}</span>
                        <span className="probe-pos">
                          ({p.x}, {p.y})
                        </span>
                      </div>
                      {m && (
                        <div className="probe-metrics">
                          pk {m.peak.toFixed(3)} · rms {m.rms.toFixed(3)} · Δφ{' '}
                          {formatPhase(i, m.phaseDeg)}
                        </div>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="probe-remove"
                    onClick={() => onRemoveProbe(i)}
                    title="Remove probe"
                    aria-label={`Remove probe ${i + 1}`}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>

          {probes.length > 1 && (
            <div className="display-mode-row">
              <span className="display-mode-label">Plot:</span>
              <div className="segmented">
                <button
                  type="button"
                  className={
                    'seg-btn' + (displayMode === 'single' ? ' seg-btn--active' : '')
                  }
                  onClick={() => setDisplayMode('single')}
                >
                  Single
                </button>
                <button
                  type="button"
                  className={
                    'seg-btn' + (displayMode === 'overlay' ? ' seg-btn--active' : '')
                  }
                  onClick={() => setDisplayMode('overlay')}
                >
                  Overlay
                </button>
              </div>
            </div>
          )}

          <div className="probe-plot">
            <div className="probe-plot-title">
              {displayMode === 'overlay' && probes.length > 1
                ? `Ez at all probes`
                : `Ez at P${selectedIndex + 1}`}
              <span className="probe-plot-axis">vs. time (steps, newest →)</span>
            </div>
            <canvas ref={timeCanvasRef} className="probe-plot-canvas" />
          </div>

          <div className="probe-plot">
            <div className="probe-plot-title">
              <span>Spectrum</span>
              <div className="segmented spectrum-scale">
                <button
                  type="button"
                  className={
                    'seg-btn' + (spectrumScale === 'linear' ? ' seg-btn--active' : '')
                  }
                  onClick={() => setSpectrumScale('linear')}
                >
                  Lin
                </button>
                <button
                  type="button"
                  className={
                    'seg-btn' + (spectrumScale === 'db' ? ' seg-btn--active' : '')
                  }
                  onClick={() => setSpectrumScale('db')}
                >
                  dB
                </button>
              </div>
            </div>
            <canvas ref={spectrumCanvasRef} className="probe-plot-canvas" />
          </div>
        </>
      )}
    </aside>
  )
}

function formatVSWR(vswr: number): string {
  if (!isFinite(vswr)) return '∞'
  if (vswr > 99) return '> 99'
  return vswr.toFixed(2)
}

function formatPhase(probeIndex: number, phaseDeg: number): string {
  if (probeIndex === 0) return '0°'
  const sign = phaseDeg >= 0 ? '+' : ''
  return `${sign}${phaseDeg.toFixed(0)}°`
}

function extractChronological(
  snap: ProbeHistorySnapshot,
  probeIndex: number,
): Float32Array {
  const offset = probeIndex * snap.historyLen
  const out = new Float32Array(snap.historyLen)
  for (let i = 0; i < snap.historyLen; i++) {
    out[i] = snap.shadow[offset + ((snap.head + i) % snap.historyLen)]
  }
  return out
}

function computeGlobalPeak(snap: ProbeHistorySnapshot): number {
  let peak = 1e-6
  const end = snap.probeCount * snap.historyLen
  for (let i = 0; i < end; i++) {
    const a = Math.abs(snap.shadow[i])
    if (a > peak) peak = a
  }
  return peak
}

function computeAllMetrics(
  snap: ProbeHistorySnapshot,
  sourcePeriod: number,
): ProbeMetrics[] {
  const N = snap.historyLen
  const sourceBin = Math.max(
    1,
    Math.min(N / 2 - 1, Math.round(N / sourcePeriod)),
  )
  const win = hannWindow(N)
  const result: ProbeMetrics[] = []
  let p1Phase = 0
  for (let p = 0; p < snap.probeCount; p++) {
    const samples = extractChronological(snap, p)
    let peak = 0
    let sumSq = 0
    for (let i = 0; i < N; i++) {
      const a = Math.abs(samples[i])
      if (a > peak) peak = a
      sumSq += samples[i] * samples[i]
    }
    const rms = Math.sqrt(sumSq / N)

    const windowed = new Float32Array(N)
    for (let i = 0; i < N; i++) windowed[i] = samples[i] * win[i]
    const { re, im } = fftReal(windowed)
    const phase = Math.atan2(im[sourceBin], re[sourceBin])
    if (p === 0) p1Phase = phase
    let relPhase = phase - p1Phase
    while (relPhase > Math.PI) relPhase -= 2 * Math.PI
    while (relPhase < -Math.PI) relPhase += 2 * Math.PI

    result.push({ peak, rms, phaseDeg: (relPhase * 180) / Math.PI })
  }
  return result
}

function computeVSWR(metrics: ProbeMetrics[]): {
  vswr: number
  gamma: number
  returnLoss: number
} | null {
  if (metrics.length < 2) return null
  let max = 0
  let min = Infinity
  for (const m of metrics) {
    if (m.peak > max) max = m.peak
    if (m.peak < min) min = m.peak
  }
  if (max < 1e-4) return null
  if (min < 1e-6) {
    return { vswr: Infinity, gamma: 1, returnLoss: 0 }
  }
  const vswr = max / min
  const gamma = (vswr - 1) / (vswr + 1)
  const returnLoss = gamma > 1e-9 ? -20 * Math.log10(gamma) : Infinity
  return { vswr, gamma, returnLoss }
}

function ensureCanvasSize(canvas: HTMLCanvasElement | null): {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
} | null {
  if (!canvas) return null
  const dpr = window.devicePixelRatio || 1
  const targetW = Math.max(1, Math.floor(canvas.clientWidth * dpr))
  const targetH = Math.max(1, Math.floor(canvas.clientHeight * dpr))
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  return { ctx, w: canvas.width, h: canvas.height }
}

function clearPlot(canvas: HTMLCanvasElement | null) {
  const r = ensureCanvasSize(canvas)
  if (!r) return
  r.ctx.fillStyle = '#0a0a0f'
  r.ctx.fillRect(0, 0, r.w, r.h)
}

function drawTimeSeries(
  canvas: HTMLCanvasElement | null,
  allSamples: Float32Array[],
  selectedIndex: number,
  mode: DisplayMode,
  globalPeak: number,
) {
  const r = ensureCanvasSize(canvas)
  if (!r) return
  const { ctx, w, h } = r

  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, w, h)

  const yMax = Math.max(0.1, Math.ceil(globalPeak * 10) / 10)
  const yMin = -yMax

  ctx.strokeStyle = '#222'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  const yScale = h / (yMax - yMin)
  const indices =
    mode === 'overlay'
      ? allSamples.map((_, i) => i)
      : [Math.min(selectedIndex, allSamples.length - 1)]
  const xStep = w / Math.max(1, allSamples[0].length - 1)

  const drawOrder = [...indices].sort((a, b) =>
    a === selectedIndex ? 1 : b === selectedIndex ? -1 : 0,
  )

  for (const p of drawOrder) {
    const samples = allSamples[p]
    const isSelected = p === selectedIndex
    ctx.strokeStyle = probeColor(p)
    ctx.globalAlpha = mode === 'overlay' && !isSelected ? 0.55 : 1.0
    ctx.lineWidth = isSelected ? 1.5 : 1
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) {
      const x = i * xStep
      const y = h - (samples[i] - yMin) * yScale
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1.0
  ctx.lineWidth = 1

  const dpr = window.devicePixelRatio || 1
  ctx.fillStyle = '#777'
  ctx.font = `${10 * dpr}px system-ui`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`Y = ±${yMax.toFixed(2)}`, 6 * dpr, 4)
}

function drawSpectrum(
  canvas: HTMLCanvasElement | null,
  allSamples: Float32Array[],
  selectedIndex: number,
  mode: DisplayMode,
  sourcePeriod: number,
  scale: SpectrumScale,
) {
  const r = ensureCanvasSize(canvas)
  if (!r) return
  const { ctx, w, h } = r

  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, w, h)

  const N = allSamples[0].length
  const win = hannWindow(N)
  const indices =
    mode === 'overlay'
      ? allSamples.map((_, i) => i)
      : [Math.min(selectedIndex, allSamples.length - 1)]

  const mags: Float32Array[] = indices.map((p) => {
    const windowed = new Float32Array(N)
    const samples = allSamples[p]
    for (let i = 0; i < N; i++) windowed[i] = samples[i] * win[i]
    return fftReal(windowed).magnitude
  })

  const sourceBin = N / Math.max(4, sourcePeriod)
  const maxBin = Math.min(mags[0].length, Math.max(32, Math.ceil(sourceBin * 10)))

  let peak = 1e-6
  for (const m of mags) {
    for (let i = 1; i < maxBin; i++) {
      if (m[i] > peak) peak = m[i]
    }
  }

  // dB-scale gridlines at -20, -40 dB.
  if (scale === 'db') {
    ctx.strokeStyle = '#1a1a24'
    ctx.lineWidth = 1
    for (const db of [-20, -40]) {
      const y = h - ((db + 60) / 60) * (h - 4) - 2
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
  }

  // Source-frequency reference line.
  const fSource = 1 / sourcePeriod
  const sourceX = (sourceBin / maxBin) * w
  ctx.strokeStyle = '#5a4a1a'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(sourceX, 0)
  ctx.lineTo(sourceX, h)
  ctx.stroke()

  const xStep = w / maxBin
  const drawOrder = indices
    .map((_, i) => i)
    .sort((a, b) =>
      indices[a] === selectedIndex ? 1 : indices[b] === selectedIndex ? -1 : 0,
    )

  for (const i of drawOrder) {
    const m = mags[i]
    const probeIdx = indices[i]
    const isSelected = probeIdx === selectedIndex
    ctx.strokeStyle = probeColor(probeIdx)
    ctx.globalAlpha = mode === 'overlay' && !isSelected ? 0.55 : 1.0
    ctx.lineWidth = isSelected ? 1.5 : 1
    ctx.beginPath()
    for (let bin = 0; bin < maxBin; bin++) {
      const x = bin * xStep
      const norm = m[bin] / peak
      let yNorm: number
      if (scale === 'db') {
        const db = norm > 1e-9 ? 20 * Math.log10(norm) : -120
        yNorm = Math.max(0, (db + 60) / 60)
      } else {
        yNorm = norm
      }
      const y = h - yNorm * (h - 4)
      if (bin === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1.0
  ctx.lineWidth = 1

  const selMag = mags[Math.max(0, drawOrder[drawOrder.length - 1])]
  let peakBin = 1
  for (let bin = 2; bin < maxBin; bin++) {
    if (selMag[bin] > selMag[peakBin]) peakBin = bin
  }
  const peakFreq = peakBin / N
  const peakLambda = 1 / peakFreq / Math.SQRT2

  const dpr = window.devicePixelRatio || 1
  ctx.fillStyle = '#777'
  ctx.font = `${10 * dpr}px system-ui`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(
    `f_peak=${peakFreq.toFixed(4)} (λ=${peakLambda.toFixed(1)} cells)   f_src=${fSource.toFixed(4)}`,
    6 * dpr,
    4,
  )
}
