// FDTD 2D TMz — H update.
// Reads Ez at time n, writes Hx, Hy at time n+1/2.
//
// Yee layout: Ez at (i, j), Hx at (i, j+1/2), Hy at (i+1/2, j).
// All three arrays use a flat row-major buffer indexed as j*W + i.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ez: array<f32>;
@group(0) @binding(2) var<storage, read_write> hx: array<f32>;
@group(0) @binding(3) var<storage, read_write> hy: array<f32>;

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

  // Hx[i, j+1/2] -= Sc * (Ez[i, j+1] - Ez[i, j])
  if (j + 1u < H) {
    hx[idx(i, j)] -= u.sc * (ez[idx(i, j + 1u)] - ez[idx(i, j)]);
  }

  // Hy[i+1/2, j] += Sc * (Ez[i+1, j] - Ez[i, j])
  if (i + 1u < W) {
    hy[idx(i, j)] += u.sc * (ez[idx(i + 1u, j)] - ez[idx(i, j)]);
  }
}
