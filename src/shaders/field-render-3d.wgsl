// 3D field renderer — fullscreen triangle samples one slice of the 3D
// volume. view_axis selects orientation, view_depth selects depth along
// that axis. view_mode = 0 → signed Ez (red/blue), 1 → |E| envelope
// (heat ramp).

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

const VIEW_AXIS_XY: u32 = 0u;
const VIEW_AXIS_XZ: u32 = 1u;
const VIEW_AXIS_YZ: u32 = 2u;
const VIEW_EZ: u32 = 0u;
const VIEW_MAG: u32 = 1u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ez: array<f32>;
@group(0) @binding(2) var<storage, read> env: array<f32>;
@group(0) @binding(3) var<storage, read> material: array<vec2<f32>>;

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
const MAG_GAIN: f32 = 1.6;

fn heat_color(v: f32) -> vec3<f32> {
  let t = clamp(v, 0.0, 1.0);
  return vec3<f32>(
    clamp(t * 3.0, 0.0, 1.0),
    clamp(t * 3.0 - 1.0, 0.0, 1.0),
    clamp(t * 3.0 - 2.0, 0.0, 1.0),
  );
}

fn material_bg(er: f32, s: f32) -> vec3<f32> {
  if (s < 0.0) { return vec3<f32>(0.75, 0.75, 0.78); }  // PEC sentinel
  let lossy_tint = vec3<f32>(0.22, 0.10, 0.06) * clamp(sqrt(s) * 1.2, 0.0, 1.6);
  let diel_tint  = vec3<f32>(0.04, 0.16, 0.24) * clamp((er - 1.0) / 3.0, 0.0, 2.0);
  return lossy_tint + diel_tint;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;

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

  let cell = i + j * W + k * W * H;
  let mat = material[cell];
  let bg = material_bg(mat.x, mat.y);

  var field: vec3<f32>;
  if (u.view_mode == VIEW_MAG) {
    let m = env[cell];
    field = heat_color(sqrt(m) * MAG_GAIN);
    return vec4<f32>(clamp(bg * 0.5 + field, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  } else {
    let v = ez[cell];
    let n = clamp(v * DISPLAY_GAIN, -1.0, 1.0);
    let pos = max(n, 0.0);
    let neg = max(-n, 0.0);
    field = vec3<f32>(pos, 0.06 * (pos + neg), neg);
    return vec4<f32>(clamp(bg + field, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }
}
