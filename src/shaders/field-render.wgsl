// Field renderer — samples Ez = Ezx + Ezy and overlays it onto a material
// background tint derived from per-cell (εr, σ, PEC flag).

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
  pml_thickness: u32,
  _pad: u32,
};

const FLAG_PEC: u32 = 1u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ezx: array<f32>;
@group(0) @binding(2) var<storage, read> ezy: array<f32>;
@group(0) @binding(3) var<storage, read> material: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> flags: array<u32>;

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

const DISPLAY_GAIN: f32 = 3.0;

// Continuous tint. sqrt(σ) on the lossy channel so small loss tangents
// (Df ≈ 0.02 for FR-4, ≈ 0.001 for glass) still leave a visible hint,
// while saturating gracefully toward σ=2.
fn material_bg(er: f32, s: f32, pec: bool) -> vec3<f32> {
  if (pec) { return vec3<f32>(0.75, 0.75, 0.78); }
  let lossy_tint = vec3<f32>(0.22, 0.10, 0.06) * clamp(sqrt(s) * 1.2, 0.0, 1.6);
  let diel_tint  = vec3<f32>(0.04, 0.16, 0.24) * clamp((er - 1.0) / 3.0, 0.0, 2.0);
  return lossy_tint + diel_tint;
}

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
  let field = vec3<f32>(pos, 0.06 * (pos + neg), neg);

  let pec = (flags[k] & FLAG_PEC) != 0u;
  let mat = material[k];
  let bg = material_bg(mat.x, mat.y, pec);
  let result = clamp(bg + field, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(result, 1.0);
}
