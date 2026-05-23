// FDTD 2D TMz — E update + source injection.
// Reads Hx, Hy at time n+1/2, writes Ez at time n+1.
//
// All four interior boundaries (i=0, i=W-1, j=0, j=H-1) hold Ez at 0,
// giving a PEC (perfect-electric-conductor) wall on every edge.
// Waves will reflect with sign flip. M3 replaces this with PML.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ez: array<f32>;
@group(0) @binding(2) var<storage, read> hx: array<f32>;
@group(0) @binding(3) var<storage, read> hy: array<f32>;

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

  // Interior update only — outer ring of cells stays at Ez=0 (PEC wall).
  if (i > 0u && i + 1u < W && j > 0u && j + 1u < H) {
    let dhy = hy[idx(i, j)] - hy[idx(i - 1u, j)];
    let dhx = hx[idx(i, j)] - hx[idx(i, j - 1u)];
    ez[idx(i, j)] += u.sc * (dhy - dhx);
  }

  // Hard sinusoidal source — overwrites Ez at the source cell each step.
  if (i == u.source.x && j == u.source.y) {
    ez[idx(i, j)] = u.source_value;
  }
}
