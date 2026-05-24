import type { Scene } from './types'
import { hertzianDipole } from './antennas/hertzian'
import { halfWaveDipole } from './antennas/half-wave-dipole'
import { cornerReflector } from './antennas/corner-reflector'
import { parabolicReflector } from './antennas/parabolic'
import { broadsideArray } from './antennas/broadside-array'
import { microstrip } from './pcb/microstrip'
import { stripline } from './pcb/stripline'
import { differentialPair } from './pcb/differential-pair'

export type { Scene, SceneCategory } from './types'

export const ALL_SCENES: Scene[] = [
  hertzianDipole,
  halfWaveDipole,
  cornerReflector,
  parabolicReflector,
  broadsideArray,
  microstrip,
  stripline,
  differentialPair,
]
