// Field renderer — fullscreen triangle that reads the Ez storage buffer
// and color-maps to a diverging red↔blue palette.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ez: array<f32>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

// Boost so far-field wave amplitudes are visible. 2D cylindrical waves
// decay as 1/sqrt(r), so the field is much weaker far from the source.
const DISPLAY_GAIN: f32 = 3.0;

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let W = u.size.x;
  let H = u.size.y;
  let coord = in.uv * vec2<f32>(f32(W), f32(H));
  let i = clamp(u32(coord.x), 0u, W - 1u);
  let j = clamp(u32(coord.y), 0u, H - 1u);
  let v = ez[j * W + i];

  let n = clamp(v * DISPLAY_GAIN, -1.0, 1.0);
  let pos = max(n, 0.0);
  let neg = max(-n, 0.0);
  return vec4<f32>(pos, 0.06 * (pos + neg), neg, 1.0);
}
