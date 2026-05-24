// In-place radix-2 Cooley-Tukey FFT. Real input → complex output. N must be
// a power of 2. Used by the spectrum analyzer. No dependencies.

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

// Bit-reversal permutation in place.
function bitReverse(re: Float32Array, im: Float32Array, n: number) {
  let j = 0
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
    let m = n >> 1
    while (m >= 1 && j >= m) {
      j -= m
      m >>= 1
    }
    j += m
  }
}

export interface FFTResult {
  re: Float32Array
  im: Float32Array
  // Magnitude of the first N/2 bins (the meaningful half for real inputs).
  magnitude: Float32Array
}

// Compute the FFT of a real-valued signal of length N (must be a power of 2).
// Returns the complex output and a precomputed magnitude array of the first
// N/2 bins. Bin k corresponds to frequency k / N (cycles per sample).
export function fftReal(input: Float32Array): FFTResult {
  const n = input.length
  if (!isPow2(n)) {
    throw new Error(`FFT length must be a power of 2, got ${n}`)
  }
  const re = new Float32Array(input)
  const im = new Float32Array(n)

  bitReverse(re, im, n)

  for (let size = 2; size <= n; size *= 2) {
    const half = size >> 1
    const tableStep = (2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = -tableStep * k
        const wRe = Math.cos(angle)
        const wIm = Math.sin(angle)
        const i0 = start + k
        const i1 = i0 + half
        const tre = wRe * re[i1] - wIm * im[i1]
        const tim = wRe * im[i1] + wIm * re[i1]
        re[i1] = re[i0] - tre
        im[i1] = im[i0] - tim
        re[i0] = re[i0] + tre
        im[i0] = im[i0] + tim
      }
    }
  }

  const half = n >> 1
  const magnitude = new Float32Array(half)
  for (let k = 0; k < half; k++) {
    magnitude[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  }
  return { re, im, magnitude }
}

// Hann window — multiply this elementwise into the signal before FFT to
// suppress sidelobes from the rectangular truncation. Returns a freshly
// allocated array of length n.
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }
  return w
}
