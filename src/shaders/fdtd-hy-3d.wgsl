// 3D FDTD Hy update with CPML (M9b).
//   μ ∂Hy/∂t = (1/κ_x) ∂Ez/∂x − (1/κ_z) ∂Ex/∂z + ψH_y_x − ψH_y_z
// ψ pack: .x = ψ_x, .y = ψ_z

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
@group(0) @binding(1) var<storage, read_write> hy: array<f32>;
@group(0) @binding(2) var<storage, read> ez: array<f32>;
@group(0) @binding(3) var<storage, read> ex: array<f32>;
@group(0) @binding(4) var<storage, read_write> psi_hy: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_z: array<vec4<f32>>;

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
  if (i + 1u >= W || k + 1u >= D) { return; }

  let curlEz = ez[idx(i + 1u, j, k)] - ez[idx(i, j, k)];
  let curlEx = ex[idx(i, j, k + 1u)] - ex[idx(i, j, k)];

  let px = pml_x[i];
  let pz = pml_z[k];

  let cell = idx(i, j, k);
  var psi = psi_hy[cell];
  psi.x = px.z * psi.x + px.w * curlEz;
  psi.y = pz.z * psi.y + pz.w * curlEx;
  psi_hy[cell] = psi;

  hy[cell] = hy[cell] + u.sc * (curlEz - curlEx + psi.x - psi.y);
}
