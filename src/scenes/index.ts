import type { Scene } from './types'
import { hertzianDipole } from './antennas/hertzian'
import { halfWaveDipole } from './antennas/half-wave-dipole'
import { yagiUda } from './antennas/yagi-uda'
import { cornerReflector } from './antennas/corner-reflector'
import { parabolicReflector } from './antennas/parabolic'
import { broadsideArray } from './antennas/broadside-array'
import { txRxLink } from './antennas/tx-rx-link'
import { microstrip } from './pcb/microstrip'
import { stripline } from './pcb/stripline'
import { differentialPair } from './pcb/differential-pair'
import { pointSource3D } from './3d/point-source-3d'
import { verticalDipole3D } from './3d/vertical-dipole-3d'
import { horizontalDipole3D } from './3d/horizontal-dipole-3d'
import { monopoleGround3D } from './3d/monopole-ground-3d'
import { broadsideArray3D } from './3d/broadside-array-3d'
import { yagiUda3D } from './3d/yagi-uda-3d'

export type { Scene, SceneCategory } from './types'

export const ALL_SCENES: Scene[] = [
  hertzianDipole,
  halfWaveDipole,
  yagiUda,
  cornerReflector,
  parabolicReflector,
  broadsideArray,
  txRxLink,
  microstrip,
  stripline,
  differentialPair,
  pointSource3D,
  verticalDipole3D,
  horizontalDipole3D,
  monopoleGround3D,
  broadsideArray3D,
  yagiUda3D,
]
