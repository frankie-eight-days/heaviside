export const MAT_VACUUM = 0
export const MAT_PEC = 1
export const MAT_MATERIAL = 2

interface MaterialOption {
  id: number
  label: string
  swatch: string
}

const MATERIALS: MaterialOption[] = [
  { id: MAT_VACUUM, label: 'Eraser', swatch: '#0a0a0f' },
  { id: MAT_PEC, label: 'PEC', swatch: '#bdbdc2' },
  { id: MAT_MATERIAL, label: 'Material', swatch: '#2f5a93' },
]

const TIP_PEC =
  'Perfect Electric Conductor: a flawless mirror for EM waves. Stand-in for metals (copper, aluminum) at RF — no field can exist inside, so waves bounce.'

const TIP_DK =
  'Dielectric constant (εr). How much the material slows EM waves: speed inside = c / √Dk. Vacuum = 1, FR-4 ≈ 4.4, glass ≈ 6, water ≈ 80. Higher Dk also means a shorter wavelength inside the material — that\'s why high-Dk substrates let you build smaller antennas.'

const TIP_DF =
  'Loss tangent (tan δ). Fraction of wave energy converted to heat per radian of oscillation. Teflon ≈ 0.0002 (basically lossless), FR-4 ≈ 0.02 (fine at MHz, lossy at GHz), foam absorber ≈ 1+ (eats the wave). Df is evaluated at the source frequency.'

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
  onUndo,
  onResetFields,
  onResetMaterials,
  canUndo,
}: ToolbarProps) {
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
            title={m.id === MAT_PEC ? TIP_PEC : undefined}
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
