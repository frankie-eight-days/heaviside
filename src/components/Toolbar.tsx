import type {
  ModulationParams,
  SourceMode,
  SourceWaveform,
  ViewMode,
} from '../gpu/fdtd'

export const MAT_VACUUM = 0
export const MAT_PEC = 1
export const MAT_MATERIAL = 2
export const MAT_SOURCE = 3
export const MAT_PROBE = 4

interface MaterialOption {
  id: number
  label: string
  swatch: string
  title?: string
}

const TIP_PEC =
  'Perfect Electric Conductor: a flawless mirror for EM waves. Stand-in for metals (copper, aluminum) at RF — no field can exist inside, so waves bounce.'

const TIP_DK =
  "Dielectric constant (εr). How much the material slows EM waves: speed inside = c / √Dk. Vacuum = 1, FR-4 ≈ 4.4, glass ≈ 6, water ≈ 80. Higher Dk also means a shorter wavelength inside the material — that's why high-Dk substrates let you build smaller antennas."

const TIP_DF =
  'Loss tangent (tan δ). Fraction of wave energy converted to heat per radian of oscillation. Teflon ≈ 0.0002 (basically lossless), FR-4 ≈ 0.02 (fine at MHz, lossy at GHz), foam absorber ≈ 1+ (eats the wave). Df is evaluated at the source frequency.'

const TIP_SOURCE =
  'Place a source: click anywhere on the canvas to move the source to that cell. The yellow marker shows the current position. Combine with Pulse mode to fire a clean wavefront.'

const TIP_PROBE =
  'Place a probe: click to drop one, or click-and-drag to drop a line of evenly-spaced probes (great for VSWR along a transmission line). Up to 32 probes total.'

const TIP_WAVELENGTH =
  'Wavelength in vacuum, measured in grid cells. Smaller wavelength = higher frequency. With Material painted nearby, the wavelength inside it shrinks by √Dk.'

const TIP_VIEW =
  'Ez shows the instantaneous field (red = positive, blue = negative). Magnitude shows the time-averaged peak amplitude — radiation patterns and standing waves stay visible.'

const MATERIALS: MaterialOption[] = [
  { id: MAT_VACUUM, label: 'Eraser', swatch: '#0a0a0f' },
  { id: MAT_PEC, label: 'PEC', swatch: '#bdbdc2', title: TIP_PEC },
  { id: MAT_MATERIAL, label: 'Material', swatch: '#2f5a93' },
  { id: MAT_SOURCE, label: 'Source', swatch: '#ffd633', title: TIP_SOURCE },
  { id: MAT_PROBE, label: 'Probe', swatch: '#ffffff', title: TIP_PROBE },
]

export interface MaterialPreset {
  label: string
  dk: number
  df: number
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { label: 'Teflon', dk: 2.1, df: 0.0002 },
  { label: 'FR-4', dk: 4.4, df: 0.02 },
  { label: 'Concrete', dk: 4.0, df: 0.05 },
  { label: 'Foam absorber', dk: 1.5, df: 1.0 },
]

const SOURCE_MODES: { id: SourceMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'cw', label: 'CW' },
  { id: 'pulse', label: 'Pulse' },
]

const WAVEFORMS: { id: SourceWaveform; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'sawtooth', label: 'Sawtooth' },
  { id: 'am', label: 'AM' },
  { id: 'fm', label: 'FM' },
]

const TIP_WAVEFORM =
  "Source waveform. Square and Sawtooth excite a comb of harmonics — watch the spectrum analyzer fill up. AM produces carrier ± modulator sidebands. FM produces a Bessel-shaped multi-peak comb."

// Convert between user-facing wavelength (in cells) and the engine's source
// period (in timesteps). λ_cells = period · Sc, with Sc = 1/√2.
const SC = 1 / Math.SQRT2
export function periodToWavelength(period: number): number {
  return period * SC
}
export function wavelengthToPeriod(wavelength: number): number {
  return wavelength / SC
}

interface ToolbarProps {
  material: number
  onMaterialChange: (id: number) => void
  brushRadius: number
  onBrushChange: (r: number) => void
  dk: number
  onDkChange: (v: number) => void
  df: number
  onDfChange: (v: number) => void
  onPreset: (p: MaterialPreset) => void
  sourcePeriod: number
  onSourcePeriodChange: (v: number) => void
  sourceMode: SourceMode
  onSourceModeChange: (m: SourceMode) => void
  sourceWaveform: SourceWaveform
  onSourceWaveformChange: (w: SourceWaveform) => void
  modulation: ModulationParams
  onModulationChange: (params: Partial<ModulationParams>) => void
  onFirePulse: () => void
  probesPerLine: number
  onProbesPerLineChange: (n: number) => void
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void
  onUndo: () => void
  onResetFields: () => void
  onResetMaterials: () => void
  canUndo: boolean
}

export default function Toolbar({
  material,
  onMaterialChange,
  brushRadius,
  onBrushChange,
  dk,
  onDkChange,
  df,
  onDfChange,
  onPreset,
  sourcePeriod,
  onSourcePeriodChange,
  sourceMode,
  onSourceModeChange,
  sourceWaveform,
  onSourceWaveformChange,
  modulation,
  onModulationChange,
  onFirePulse,
  probesPerLine,
  onProbesPerLineChange,
  viewMode,
  onViewModeChange,
  onUndo,
  onResetFields,
  onResetMaterials,
  canUndo,
}: ToolbarProps) {
  const wavelength = periodToWavelength(sourcePeriod)
  const modWavelength = periodToWavelength(modulation.modPeriod)

  return (
    <div className="toolbar">
      <div className="material-group">
        {MATERIALS.map((m) => (
          <button
            key={m.id}
            className={
              'material-btn' + (material === m.id ? ' material-btn--active' : '')
            }
            onClick={() => onMaterialChange(m.id)}
            type="button"
            title={m.title}
          >
            <span className="material-swatch" style={{ background: m.swatch }} />
            {m.label}
          </button>
        ))}
      </div>

      {material === MAT_MATERIAL && (
        <>
          <label className="param-slider" title={TIP_DK}>
            Dk <span className="info-glyph">ⓘ</span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.1}
              value={dk}
              onChange={(e) => onDkChange(Number(e.target.value))}
            />
            <span className="param-value">{dk.toFixed(2)}</span>
          </label>
          <label className="param-slider" title={TIP_DF}>
            Df <span className="info-glyph">ⓘ</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.001}
              value={df}
              onChange={(e) => onDfChange(Number(e.target.value))}
            />
            <span className="param-value">{df.toFixed(3)}</span>
          </label>
          <div className="preset-group">
            {MATERIAL_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="preset-btn"
                onClick={() => onPreset(p)}
                title={`Dk=${p.dk}, Df=${p.df}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}

      {material === MAT_SOURCE && (
        <>
          <label className="param-slider" title={TIP_WAVELENGTH}>
            λ (cells) <span className="info-glyph">ⓘ</span>
            <input
              type="range"
              min={10}
              max={120}
              step={1}
              value={Math.round(wavelength)}
              onChange={(e) =>
                onSourcePeriodChange(wavelengthToPeriod(Number(e.target.value)))
              }
            />
            <span className="param-value">{Math.round(wavelength)}</span>
          </label>
          <label className="param-select" title={TIP_WAVEFORM}>
            Waveform <span className="info-glyph">ⓘ</span>
            <select
              className="waveform-select"
              value={sourceWaveform}
              onChange={(e) => onSourceWaveformChange(e.target.value as SourceWaveform)}
            >
              {WAVEFORMS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          {sourceWaveform === 'square' && (
            <label className="param-slider">
              Edge
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={modulation.squareEdge}
                onChange={(e) =>
                  onModulationChange({ squareEdge: Number(e.target.value) })
                }
              />
              <span className="param-value">{modulation.squareEdge}</span>
            </label>
          )}
          {(sourceWaveform === 'am' || sourceWaveform === 'fm') && (
            <label className="param-slider">
              mod λ
              <input
                type="range"
                min={20}
                max={400}
                step={1}
                value={Math.round(modWavelength)}
                onChange={(e) =>
                  onModulationChange({
                    modPeriod: wavelengthToPeriod(Number(e.target.value)),
                  })
                }
              />
              <span className="param-value">{Math.round(modWavelength)}</span>
            </label>
          )}
          {sourceWaveform === 'am' && (
            <label className="param-slider">
              depth
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={modulation.amDepth}
                onChange={(e) =>
                  onModulationChange({ amDepth: Number(e.target.value) })
                }
              />
              <span className="param-value">{modulation.amDepth.toFixed(2)}</span>
            </label>
          )}
          {sourceWaveform === 'fm' && (
            <label className="param-slider">
              β
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={modulation.fmIndex}
                onChange={(e) =>
                  onModulationChange({ fmIndex: Number(e.target.value) })
                }
              />
              <span className="param-value">{modulation.fmIndex.toFixed(1)}</span>
            </label>
          )}
          <div className="segmented">
            {SOURCE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={
                  'seg-btn' + (sourceMode === m.id ? ' seg-btn--active' : '')
                }
                onClick={() => onSourceModeChange(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {sourceMode === 'pulse' && (
            <button
              type="button"
              className="action-btn action-btn--primary"
              onClick={onFirePulse}
            >
              Fire
            </button>
          )}
        </>
      )}

      {material === MAT_PROBE && (
        <label
          className="param-slider"
          title="Number of probes placed when you click-and-drag a line on the canvas."
        >
          Probes per line
          <input
            type="range"
            min={2}
            max={32}
            step={1}
            value={probesPerLine}
            onChange={(e) => onProbesPerLineChange(Number(e.target.value))}
          />
          <span className="param-value">{probesPerLine}</span>
        </label>
      )}

      <label className="param-slider">
        Brush
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={brushRadius}
          onChange={(e) => onBrushChange(Number(e.target.value))}
        />
        <span className="param-value">{brushRadius}</span>
      </label>

      <div className="segmented" title={TIP_VIEW}>
        <button
          type="button"
          className={'seg-btn' + (viewMode === 'ez' ? ' seg-btn--active' : '')}
          onClick={() => onViewModeChange('ez')}
        >
          Ez
        </button>
        <button
          type="button"
          className={'seg-btn' + (viewMode === 'magnitude' ? ' seg-btn--active' : '')}
          onClick={() => onViewModeChange('magnitude')}
        >
          Magnitude
        </button>
      </div>

      <div className="action-group">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="action-btn"
          title="Undo (⌘Z / Ctrl+Z)"
        >
          Undo
        </button>
        <button type="button" onClick={onResetFields} className="action-btn">
          Reset fields
        </button>
        <button type="button" onClick={onResetMaterials} className="action-btn">
          Reset materials
        </button>
      </div>
    </div>
  )
}
