import { createFDTD, type FDTDEngine, type Polarization } from './fdtd'
import { createFDTD_TEz } from './fdtd-tez'
import { createFDTD_3D } from './fdtd-3d'
import type { GPUContext } from './init'

export function createEngine(gpu: GPUContext, polarization: Polarization): FDTDEngine {
  if (polarization === '3D') return createFDTD_3D(gpu)
  if (polarization === 'TEz') return createFDTD_TEz(gpu)
  return createFDTD(gpu)
}
