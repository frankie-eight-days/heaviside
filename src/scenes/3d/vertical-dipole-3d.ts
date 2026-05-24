import type { Scene } from '../types'
import type { FDTDEngine3D, ProbeSpec } from '../../gpu/fdtd'

const SC_3D = 0.99 / Math.sqrt(3)
const PEC_BRUSH = { epsilonR: 1, sigma: 0, pec: true }

export const verticalDipole3D: Scene = {
  id: '3d-vertical-dipole',
  category: '3d',
  name: 'Vertical λ/2 dipole',
  description:
    'Two PEC arms along the z-axis with a feed gap at the center, driven by an Ez source. Opens in the XZ slice — the canonical figure-8 cross-section. Switch to XY to see the broadside ring. Switch to YZ for the same figure-8 rotated 90°. Volume mode reveals the full 3D donut.',
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 60
    const engine3D = engine as FDTDEngine3D
    engine3D.resetMaterials()
    engine3D.resetFields()
    engine3D.setSourcePeriod(period)
    engine3D.setSourceMode('cw')

    const { width: W, height: H, depth: D } = engine3D.getDims3D()
    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2)
    const cz = Math.floor(D / 2)

    const lambdaCells = period * SC_3D
    // Half-arm 0.21λ for tip-to-tip ≈ 0.475λ resonance (same calc as 2D
    // dipole — half-arm = (0.475λ - gap) / 2, simplified to 0.21λ).
    const arm = Math.max(2, Math.floor(lambdaCells * 0.21))
    const gap = 2

    // 3×3-cell-cross-section arms along z. Thicker than a true thin-wire
    // antenna but the volume render and oblique camera angle make 1×1 arms
    // appear disconnected (the ray-march steps 2 cells and skips between
    // them). 3×3 reads as a solid bar from any view.
    engine3D.paintBox3D(cx - 1, cy - 1, cz + gap + 1, cx + 1, cy + 1, cz + gap + arm, PEC_BRUSH)
    engine3D.paintBox3D(cx - 1, cy - 1, cz - gap - arm, cx + 1, cy + 1, cz - gap - 1, PEC_BRUSH)

    // Feed-gap source: Ez at the antenna center drives current along z.
    engine3D.setSources3D([
      { x: cx, y: cy, z: cz, phase: 0, amplitude: 1, polarization: 'z' },
    ])

    // Probes for the canonical broadside-vs-endfire comparison. Returned as
    // 2D coords in the XZ slice's coordinate system (a = x, b = z), since
    // the scene opens with sliceAxis='xz' at depth=cy.
    const probes: ProbeSpec[] = [
      // Broadside +x at 1λ from antenna — should be the strongest.
      { x: cx + Math.round(lambdaCells), y: cz },
      // Broadside -x at 1λ — same.
      { x: cx - Math.round(lambdaCells), y: cz },
      // Endfire +z at 1λ past the tip — should be ~null.
      { x: cx, y: cz + arm + Math.round(lambdaCells) },
      // Endfire -z at 1λ past the tip — same.
      { x: cx, y: cz - arm - Math.round(lambdaCells) },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
      polarization: '3D',
      sliceAxis: 'xz',
      sliceDepth: cy,
    }
  },
}
