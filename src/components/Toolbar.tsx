export const MAT_VACUUM = 0
export const MAT_PEC = 1
export const MAT_LOSSY = 2
export const MAT_DIELECTRIC = 3

interface MaterialOption {
  id: number
  label: string
  swatch: string
}

const MATERIALS: MaterialOption[] = [
  { id: MAT_VACUUM, label: 'Eraser', swatch: '#0a0a0f' },
  { id: MAT_PEC, label: 'PEC', swatch: '#bdbdc2' },
  { id: MAT_LOSSY, label: 'Lossy', swatch: '#6b3526' },
  { id: MAT_DIELECTRIC, label: 'Dielectric', swatch: '#1f6a93' },
]

interface ToolbarProps {
  material: number
  onMaterialChange: (id: number) => void
  brushRadius: number
  onBrushChange: (r: number) => void
  epsilonR: number
  onEpsilonRChange: (v: number) => void
  sigma: number
  onSigmaChange: (v: number) => void
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
  epsilonR,
  onEpsilonRChange,
  sigma,
  onSigmaChange,
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
          >
            <span className="material-swatch" style={{ background: m.swatch }} />
            {m.label}
          </button>
        ))}
      </div>

      {material === MAT_DIELECTRIC && (
        <label className="param-slider">
          εr
          <input
            type="range"
            min={1}
            max={12}
            step={0.1}
            value={epsilonR}
            onChange={(e) => onEpsilonRChange(Number(e.target.value))}
          />
          <span className="param-value">{epsilonR.toFixed(1)}</span>
        </label>
      )}

      {material === MAT_LOSSY && (
        <label className="param-slider">
          σ
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={sigma}
            onChange={(e) => onSigmaChange(Number(e.target.value))}
          />
          <span className="param-value">{sigma.toFixed(2)}</span>
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
