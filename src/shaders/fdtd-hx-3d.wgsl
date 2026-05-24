// 3D FDTD Hx update — vacuum (M9a).
//   μ ∂Hx/∂t = ∂Ey/∂z − ∂Ez/∂y
// Hx at (i, j+½, k+½).

struct Uniforms {
  size: vec3<u32>,
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
  hx[idx(i, j, k)] = hx[idx(i, j, k)] + u.sc * (curlEy - curlEz);
}
