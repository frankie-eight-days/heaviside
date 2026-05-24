// Peak-with-decay envelope of |E| for the 3D magnitude view.
//   env[k] = max(env[k] * DECAY, sqrt(Ex² + Ey² + Ez²))
// Runs once per timestep after the source-apply pass so the envelope sees
// the source-overridden field. Mirrors the 2D envelope; decay constant matches.

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

const DECAY: f32 = 0.997;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ex: array<f32>;
@group(0) @binding(2) var<storage, read> ey: array<f32>;
@group(0) @binding(3) var<storage, read> ez: array<f32>;
@group(0) @binding(4) var<storage, read_write> env: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;
  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;
  if (i >= W || j >= H || k >= D) { return; }
  let cell = i + j * W + k * W * H;
  let exv = ex[cell];
  let eyv = ey[cell];
  let ezv = ez[cell];
  let mag = sqrt(exv * exv + eyv * eyv + ezv * ezv);
  let prev = env[cell] * DECAY;
  env[cell] = select(prev, mag, mag > prev);
}
