import type { Polarization } from '../gpu/fdtd'

interface PolarizationToggleProps {
  polarization: Polarization
  onChange: (p: Polarization) => void
}

const TIP_TMZ =
  'TMz: Ez points out of the page, Hx and Hy in plane. Best for top-down antenna views — a point source on Ez is the slice through a vertical wire antenna.'

const TIP_TEZ =
  'TEz: Hz points out of the page, Ex and Ey in plane. Best for transmission-line cross-sections — Ey is the textbook vertical E-field between microstrip trace and ground.'

const TIP_3D =
  '3D FDTD with six field components (Ex, Ey, Ez, Hx, Hy, Hz). Slice viewer at midplane by default. Heavier than 2D — defaults to a 128³ grid; 256³ supported. M9a foundation: hard PEC walls; CPML in M9b.'

export default function PolarizationToggle({
  polarization,
  onChange,
}: PolarizationToggleProps) {
  return (
    <div className="polarization-toggle segmented" title="Engine polarization">
      <button
        type="button"
        className={'seg-btn' + (polarization === 'TMz' ? ' seg-btn--active' : '')}
        onClick={() => onChange('TMz')}
        title={TIP_TMZ}
      >
        TMz
      </button>
      <button
        type="button"
        className={'seg-btn' + (polarization === 'TEz' ? ' seg-btn--active' : '')}
        onClick={() => onChange('TEz')}
        title={TIP_TEZ}
      >
        TEz
      </button>
      <button
        type="button"
        className={'seg-btn' + (polarization === '3D' ? ' seg-btn--active' : '')}
        onClick={() => onChange('3D')}
        title={TIP_3D}
      >
        3D
      </button>
    </div>
  )
}
