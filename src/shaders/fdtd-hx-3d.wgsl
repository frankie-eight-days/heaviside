// 3D FDTD Hx update with CPML (M9b).
//   μ ∂Hx/∂t = (1/κ_z) ∂Ey/∂z − (1/κ_y) ∂Ez/∂y + ψH_x_z − ψH_x_y
// ψ pack: .x = ψ_z, .y = ψ_y
// Hx lives at (i, j+½, k+½) so its PML coefficients read from pml_*.z (b_H)
// and pml_*.w (a_H) — the H-staggered half.

struct Uniforms {
  size: vec4<u32>,
  source_count: u32,
  pml_thickness: u32,
  sc: f32,
  view_axis: u32,
  view_depth: u32,
  view_mode: u32,
  probe_count: u32,
  history_head: u32,
  history_len: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> hx: array<f32>;
@group(0) @binding(2) var<storage, read> ey: array<f32>;
@group(0) @binding(3) var<storage, read> ez: array<f32>;
@group(0) @binding(4) var<storage, read_write> psi_hx: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> pml_z: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;

fn idx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * u.size.x + k * u.size.x * u.size.y;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;
  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;
  if (i >= W || j >= H || k >= D) { return; }
  if (j + 1u >= H || k + 1u >= D) { return; }

  let curlEy = ey[idx(i, j, k + 1u)] - ey[idx(i, j, k)];
  let curlEz = ez[idx(i, j + 1u, k)] - ez[idx(i, j, k)];

  let pz = pml_z[k];
  let py = pml_y[j];

  let cell = idx(i, j, k);
  var psi = psi_hx[cell];
  psi.x = pz.z * psi.x + pz.w * curlEy;
  psi.y = py.z * psi.y + py.w * curlEz;
  psi_hx[cell] = psi;

  hx[cell] = hx[cell] + u.sc * (curlEy - curlEz + psi.x - psi.y);
}
