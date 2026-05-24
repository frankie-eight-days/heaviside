// TEz H-update. Dual of fdtd-h.wgsl.
//
//   μ ∂Hz/∂t = ∂Ex/∂y - ∂Ey/∂x   (Hz at (i, j), split to Hzx + Hzy for PML)
//
// Split convention:
//   Hzx gets the -∂Ey/∂x term → x-axis PML coefficients
//   Hzy gets the +∂Ex/∂y term → y-axis PML coefficients
// Physical Hz = Hzx + Hzy.

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

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> hzx: array<f32>;
@group(0) @binding(2) var<storage, read_write> hzy: array<f32>;
@group(0) @binding(3) var<storage, read> ex: array<f32>;
@group(0) @binding(4) var<storage, read> ey: array<f32>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;

fn idx(i: u32, j: u32) -> u32 {
  return j * u.size.x + i;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }

  // Hz at (i, j) needs Ex(i, j+0.5)−Ex(i, j−0.5) and Ey(i+0.5, j)−Ey(i−0.5, j),
  // which in buffer-index terms is ex[i,j]−ex[i,j−1] and ey[i,j]−ey[i−1,j].
  if (i > 0u && j > 0u) {
    let px = pml_x[i];
    let py = pml_y[j];
    let curlEy = ey[idx(i, j)] - ey[idx(i - 1u, j)];
    let curlEx = ex[idx(i, j)] - ex[idx(i, j - 1u)];
    hzx[idx(i, j)] = px.z * hzx[idx(i, j)] - px.w * curlEy;
    hzy[idx(i, j)] = py.z * hzy[idx(i, j)] + py.w * curlEx;
  }
}
