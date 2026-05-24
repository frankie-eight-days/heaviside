// 3D FDTD Ex update — vacuum + hard PEC boundary (M9a, no PML yet).
//
//   ε ∂Ex/∂t = ∂Hz/∂y − ∂Hy/∂z   (μ_r = ε_r = 1, σ = 0)
//
// Ex at (i+½, j, k). Buffer index ex[i,j,k] holds the Ex sample at that
// staggered location. Hard PEC clamps Ex (tangential to all boundary faces
// except i=0/W-1 where it's normal — but for the M9a smoke test we clamp
// universally; M9c will be position-aware via the flags grid).

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
@group(0) @binding(1) var<storage, read_write> ex: array<f32>;
@group(0) @binding(2) var<storage, read> hz: array<f32>;
@group(0) @binding(3) var<storage, read> hy: array<f32>;

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

  // Hard PEC at every boundary face — M9a only. M9b replaces with CPML.
  if (i == 0u || i + 1u >= W ||
      j == 0u || j + 1u >= H ||
      k == 0u || k + 1u >= D) {
    ex[idx(i, j, k)] = 0.0;
    return;
  }

  let curlHz = hz[idx(i, j, k)] - hz[idx(i, j - 1u, k)];
  let curlHy = hy[idx(i, j, k)] - hy[idx(i, j, k - 1u)];
  ex[idx(i, j, k)] = ex[idx(i, j, k)] + u.sc * (curlHz - curlHy);
}
