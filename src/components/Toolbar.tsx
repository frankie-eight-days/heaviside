import {
  MAT_VACUUM,
  MAT_PEC,
  MAT_LOSSY,
  MAT_DIELECTRIC,
} from '../gpu/fdtd'

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
  onUndo: () => void
  onClear: () => void
  canUndo: boolean
}

export default function Toolbar({
  material,
  onMaterialChange,
  brushRadius,
  onBrushChange,
  onUndo,
  onClear,
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

      <label className="brush-slider">
        Brush
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={brushRadius}
          onChange={(e) => onBrushChange(Number(e.target.value))}
        />
        <span className="brush-value">{brushRadius}</span>
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
        <button type="button" onClick={onClear} className="action-btn">
          Clear
        </button>
      </div>
    </div>
  )
}
