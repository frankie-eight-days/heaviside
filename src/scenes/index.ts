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
]
