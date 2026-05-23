// Field renderer — samples Ez = Ezx + Ezy and overlays it onto the material
// background so painted PEC / lossy / dielectric regions are visible even
// when the field at that cell is zero.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
  lossy_sigma: f32,
  dielectric_er: f32,
  pml_thickness: u32,
  _pad: u32,
};

const MAT_VACUUM: u32 = 0u;
const MAT_PEC: u32 = 1u;
const MAT_LOSSY: u32 = 2u;
const MAT_DIELECTRIC: u32 = 3u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ezx: array<f32>;
@group(0) @binding(2) var<storage, read> ezy: array<f32>;
@group(0) @binding(3) var<storage, read> material: array<u32>;

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

fn material_bg(mat: u32) -> vec3<f32> {
  if (mat == MAT_PEC) { return vec3<f32>(0.75, 0.75, 0.78); }
  if (mat == MAT_LOSSY) { return vec3<f32>(0.22, 0.10, 0.06); }
  if (mat == MAT_DIELECTRIC) { return vec3<f32>(0.04, 0.16, 0.24); }
  return vec3<f32>(0.0);
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

  let bg = material_bg(material[k]);
  let result = clamp(bg + field, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(result, 1.0);
}
