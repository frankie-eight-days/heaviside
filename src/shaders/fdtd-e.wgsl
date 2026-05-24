// PML-aware Yee E-update with per-cell ε, σ and a PEC flag bit.
//
// Sources are applied by a separate compute pass (source-apply.wgsl) that
// runs after this one. This shader has no knowledge of sources.

struct Uniforms {
  size: vec2<u32>,
  source_count: u32,
  pml_thickness: u32,
  sc: f32,
  view_mode: u32,
  _pad: vec2<u32>,
};

const FLAG_PEC: u32 = 1u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ezx: array<f32>;
@group(0) @binding(2) var<storage, read_write> ezy: array<f32>;
@group(0) @binding(3) var<storage, read> hx: array<f32>;
@group(0) @binding(4) var<storage, read> hy: array<f32>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> material: array<vec2<f32>>;
@group(0) @binding(8) var<storage, read> flags: array<u32>;

fn idx(i: u32, j: u32) -> u32 {
  return j * u.size.x + i;
}

fn in_pml(i: u32, j: u32) -> bool {
  let t = u.pml_thickness;
  return i < t || j < t || i + t >= u.size.x || j + t >= u.size.y;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }

  let interior = i > 0u && i + 1u < W && j > 0u && j + 1u < H;
  if (!interior) { return; }

  let k = idx(i, j);
  let curlHy = hy[k] - hy[idx(i - 1u, j)];
  let curlHx = hx[k] - hx[idx(i, j - 1u)];

  if (in_pml(i, j)) {
    let px = pml_x[i];
    let py = pml_y[j];
    ezx[k] = px.x * ezx[k] + px.y * curlHy;
    ezy[k] = py.x * ezy[k] - py.y * curlHx;
  } else if ((flags[k] & FLAG_PEC) != 0u) {
    ezx[k] = 0.0;
    ezy[k] = 0.0;
  } else {
    let mat = material[k];
    let er = mat.x;
    let s = mat.y;
    let loss = s * u.sc / (2.0 * er);
    let denom = 1.0 + loss;
    let ca = (1.0 - loss) / denom;
    let cb = (u.sc / er) / denom;
    ezx[k] = ca * ezx[k] + cb * curlHy;
    ezy[k] = ca * ezy[k] - cb * curlHx;
  }
}
