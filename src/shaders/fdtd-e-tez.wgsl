// TEz E-update with per-cell ε, σ and a PEC flag bit. Dual of fdtd-e.wgsl.
//
//   ε ∂Ex/∂t + σ Ex =  ∂Hz/∂y   (Ex at (i, j+0.5), y-PML only)
//   ε ∂Ey/∂t + σ Ey = -∂Hz/∂x   (Ey at (i+0.5, j), x-PML only)
//
// Sources are applied by source-apply-tez.wgsl (writes to ex or ey based on
// the per-source polarization field).

struct Uniforms {
  size: vec2<u32>,
  source_count: u32,
  pml_thickness: u32,
  sc: f32,
  view_mode: u32,
  probe_count: u32,
  history_head: u32,
  history_len: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

const FLAG_PEC: u32 = 1u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ex: array<f32>;
@group(0) @binding(2) var<storage, read_write> ey: array<f32>;
@group(0) @binding(3) var<storage, read> hzx: array<f32>;
@group(0) @binding(4) var<storage, read> hzy: array<f32>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> material: array<vec2<f32>>;
@group(0) @binding(8) var<storage, read> flags: array<u32>;

fn idx(i: u32, j: u32) -> u32 {
  return j * u.size.x + i;
}

fn hz_at(i: u32, j: u32) -> f32 {
  let k = idx(i, j);
  return hzx[k] + hzy[k];
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
  // Ex at (i, j+0.5): ∂Hz/∂y ≈ Hz(i, j+1) - Hz(i, j)
  let curlEx = hz_at(i, j + 1u) - hz_at(i, j);
  // Ey at (i+0.5, j): ∂Hz/∂x ≈ Hz(i+1, j) - Hz(i, j)
  let curlEy = hz_at(i + 1u, j) - hz_at(i, j);

  if (in_pml(i, j)) {
    // Ex carries y-direction propagation → y-axis PML coefficients.
    // Ey carries x-direction propagation → x-axis PML coefficients.
    let py = pml_y[j];
    let px = pml_x[i];
    ex[k] = py.x * ex[k] + py.y * curlEx;
    ey[k] = px.x * ey[k] - px.y * curlEy;
  } else if ((flags[k] & FLAG_PEC) != 0u) {
    // PEC clamps both tangential E components (textbook over-restrictive at
    // diagonal surfaces but stable; see ADR 0009).
    ex[k] = 0.0;
    ey[k] = 0.0;
  } else {
    let mat = material[k];
    let er = mat.x;
    let s = mat.y;
    let loss = s * u.sc / (2.0 * er);
    let denom = 1.0 + loss;
    let ca = (1.0 - loss) / denom;
    let cb = (u.sc / er) / denom;
    ex[k] = ca * ex[k] + cb * curlEx;
    ey[k] = ca * ey[k] - cb * curlEy;
  }
}
