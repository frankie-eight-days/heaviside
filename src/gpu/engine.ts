import { createFDTD, type FDTDEngine, type Polarization } from './fdtd'
import { createFDTD_TEz } from './fdtd-tez'
import type { GPUContext } from './init'

export function createEngine(gpu: GPUContext, polarization: Polarization): FDTDEngine {
  if (polarization === 'TEz') return createFDTD_TEz(gpu)
  return createFDTD(gpu)
}
