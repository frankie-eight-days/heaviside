// Field renderer — samples Ez = Ezx + Ezy (the Berenger split components)
// and maps the value to a diverging red↔blue palette.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ezx: array<f32>;
@group(0) @binding(2) var<storage, read> ezy: array<f32>;

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

// 2D cylindrical waves decay as 1/sqrt(r); boost so the far field stays visible.
const DISPLAY_GAIN: f32 = 3.0;

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let W = u.size.x;
  let H = u.size.y;
  let coord = in.uv * vec2<f32>(f32(W), f32(H));
  let i = clamp(u32(coord.x), 0u, W - 1u);
  let j = clamp(u32(coord.y), 0u, H - 1u);
  let k = j * W + i;
  let v = ezx[k] + ezy[k];

  let n = clamp(v * DISPLAY_GAIN, -1.0, 1.0);
  let pos = max(n, 0.0);
  let neg = max(-n, 0.0);
  return vec4<f32>(pos, 0.06 * (pos + neg), neg, 1.0);
}
