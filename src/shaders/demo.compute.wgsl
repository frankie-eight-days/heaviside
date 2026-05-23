// Placeholder compute kernel for milestone 1.
// Writes an animated radial ripple into a storage texture so we can confirm
// the compute -> render pipeline works. This will be replaced by the real
// FDTD update equations in milestone 2.

struct Uniforms {
  time: f32,
  size: vec2<u32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var field: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.size.x || gid.y >= u.size.y) {
    return;
  }

  // Aspect-preserving coordinates: normalize by the longer edge so 1 unit in x
  // equals 1 unit in y, keeping the ripple circular on non-square fields.
  let s = vec2<f32>(f32(u.size.x), f32(u.size.y));
  let maxs = max(s.x, s.y);
  let p = (vec2<f32>(f32(gid.x), f32(gid.y)) - s * 0.5) / maxs;
  let d = length(p);

  // Outgoing ripple, attenuated with distance.
  let v = sin(d * 60.0 - u.time * 4.0) * exp(-d * 2.5);

  // Diverging colormap: red (+) -> dark (0) -> blue (-)
  let pos = max(v, 0.0);
  let neg = max(-v, 0.0);
  let color = vec3<f32>(pos, 0.08 * (pos + neg), neg);

  textureStore(field, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(color, 1.0));
}
