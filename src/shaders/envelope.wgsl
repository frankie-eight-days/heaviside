// Peak-with-decay envelope of |Ez|. Runs once per timestep after the E update.
// env[k] = max(env[k] * DECAY, |Ez[k]|)
// Decay half-life ≈ 230 steps. See docs/decisions/0004.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
  pml_thickness: u32,
  view_mode: u32,
};

const DECAY: f32 = 0.997;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ezx: array<f32>;
@group(0) @binding(2) var<storage, read> ezy: array<f32>;
@group(0) @binding(3) var<storage, read_write> env: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }
  let k = j * W + i;
  let ez = ezx[k] + ezy[k];
  let prev = env[k] * DECAY;
  let mag = abs(ez);
  env[k] = select(prev, mag, mag > prev);
}
