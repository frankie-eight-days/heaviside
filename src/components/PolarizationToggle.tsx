import type { Polarization } from '../gpu/fdtd'

interface PolarizationToggleProps {
  polarization: Polarization
  onChange: (p: Polarization) => void
}

const TIP_TMZ =
  'TMz: Ez points out of the page, Hx and Hy in plane. Best for top-down antenna views — a point source on Ez is the slice through a vertical wire antenna.'

const TIP_TEZ =
  'TEz: Hz points out of the page, Ex and Ey in plane. Best for transmission-line cross-sections — Ey is the textbook vertical E-field between microstrip trace and ground.'

const TIP_3D = '3D FDTD — M9 work. Six field components, volume rendering, real radiation patterns.'

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
        className="seg-btn seg-btn--disabled"
        disabled
        title={TIP_3D}
      >
        3D (soon)
      </button>
    </div>
  )
}
