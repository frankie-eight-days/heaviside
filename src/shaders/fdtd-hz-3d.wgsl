// 3D FDTD Hz update with CPML (M9b).
//   μ ∂Hz/∂t = (1/κ_y) ∂Ex/∂y − (1/κ_x) ∂Ey/∂x + ψH_z_y − ψH_z_x
// ψ pack: .x = ψ_y, .y = ψ_x

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
@group(0) @binding(1) var<storage, read_write> hz: array<f32>;
@group(0) @binding(2) var<storage, read> ex: array<f32>;
@group(0) @binding(3) var<storage, read> ey: array<f32>;
@group(0) @binding(4) var<storage, read_write> psi_hz: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> pml_y: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_x: array<vec4<f32>>;

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
  if (i + 1u >= W || j + 1u >= H) { return; }

  let curlEx = ex[idx(i, j + 1u, k)] - ex[idx(i, j, k)];
  let curlEy = ey[idx(i + 1u, j, k)] - ey[idx(i, j, k)];

  let py = pml_y[j];
  let px = pml_x[i];

  let cell = idx(i, j, k);
  var psi = psi_hz[cell];
  psi.x = py.z * psi.x + py.w * curlEx;
  psi.y = px.z * psi.y + px.w * curlEy;
  psi_hz[cell] = psi;

  hz[cell] = hz[cell] + u.sc * (curlEx - curlEy + psi.x - psi.y);
}
