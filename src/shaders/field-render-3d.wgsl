// 3D field renderer — fullscreen triangle samples one slice of the 3D
// volume. view_axis selects which orientation, view_depth selects the
// depth along that axis. M9a only renders signed Ez (red/blue). M9c will
// add |E| magnitude, material tint, source/probe markers.

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

const VIEW_AXIS_XY: u32 = 0u;
const VIEW_AXIS_XZ: u32 = 1u;
const VIEW_AXIS_YZ: u32 = 2u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ez: array<f32>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

const DISPLAY_GAIN: f32 = 3.0;

fn sample_ez(i: u32, j: u32, k: u32) -> f32 {
  let n = i + j * u.size.x + k * u.size.x * u.size.y;
  return ez[n];
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;

  // Map UV to volume indices based on the chosen slice axis.
  // We render the slice with a width-by-height layout that fits in the
  // canvas; the engine picks which two axes map to canvas U,V.
  var i: u32; var j: u32; var k: u32;
  if (u.view_axis == VIEW_AXIS_XY) {
    i = clamp(u32(in.uv.x * f32(W)), 0u, W - 1u);
    j = clamp(u32(in.uv.y * f32(H)), 0u, H - 1u);
    k = clamp(u.view_depth, 0u, D - 1u);
  } else if (u.view_axis == VIEW_AXIS_XZ) {
    i = clamp(u32(in.uv.x * f32(W)), 0u, W - 1u);
    j = clamp(u.view_depth, 0u, H - 1u);
    k = clamp(u32(in.uv.y * f32(D)), 0u, D - 1u);
  } else { // VIEW_AXIS_YZ
    i = clamp(u.view_depth, 0u, W - 1u);
    j = clamp(u32(in.uv.x * f32(H)), 0u, H - 1u);
    k = clamp(u32(in.uv.y * f32(D)), 0u, D - 1u);
  }

  let v = sample_ez(i, j, k);
  let n = clamp(v * DISPLAY_GAIN, -1.0, 1.0);
  let pos = max(n, 0.0);
  let neg = max(-n, 0.0);
  let bg = vec3<f32>(0.02, 0.02, 0.03);
  let field = vec3<f32>(pos, 0.06 * (pos + neg), neg);
  return vec4<f32>(clamp(bg + field, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
