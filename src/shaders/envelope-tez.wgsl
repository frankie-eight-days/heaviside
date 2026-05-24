// Peak-with-decay envelope of |E| = sqrt(Ex² + Ey²) for the TEz magnitude
// view. Mirrors envelope.wgsl. Same decay rate.

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

const DECAY: f32 = 0.997;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ex: array<f32>;
@group(0) @binding(2) var<storage, read> ey: array<f32>;
@group(0) @binding(3) var<storage, read_write> env: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }
  let k = j * W + i;
  let e_mag = sqrt(ex[k] * ex[k] + ey[k] * ey[k]);
  let prev = env[k] * DECAY;
  env[k] = select(prev, e_mag, e_mag > prev);
}
