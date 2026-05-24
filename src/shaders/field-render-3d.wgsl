// 3D field renderer — fullscreen triangle samples one slice of the 3D
// volume. view_axis selects orientation, view_depth selects depth along
// that axis. view_mode = 0 → signed Ez (red/blue with sqrt(|v|) nonlinearity
// for far-field visibility), 1 → |E| envelope (heat ramp). Draws source +
// probe markers when they live on the active slice plane.

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
  display_gain: f32,
  _pad1: u32,
  _pad2: u32,
};

struct Source3D {
  pos: vec4<u32>,
  pol: u32,
  value: f32,
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
@group(0) @binding(4) var<storage, read> sources: array<Source3D>;
@group(0) @binding(5) var<storage, read> probes: array<vec4<u32>>;

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

// Display gain from uniform — slider-controlled. MAG_GAIN stays fixed.
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

// Probe palette — kept in sync with PROBE_COLORS in MeasurementPanel.tsx so
// the canvas marker matches the plot trace.
fn probe_color(index: u32) -> vec3<f32> {
  switch (index % 8u) {
    case 0u: { return vec3<f32>(0.40, 0.76, 1.00); }
    case 1u: { return vec3<f32>(0.61, 0.88, 0.40); }
    case 2u: { return vec3<f32>(1.00, 0.42, 0.66); }
    case 3u: { return vec3<f32>(1.00, 0.67, 0.27); }
    case 4u: { return vec3<f32>(1.00, 0.92, 0.33); }
    case 5u: { return vec3<f32>(0.73, 0.53, 1.00); }
    case 6u: { return vec3<f32>(0.73, 0.92, 0.33); }
    default: { return vec3<f32>(0.87, 0.87, 0.93); }
  }
}

// Project (vx, vy, vz) volume position into the active slice plane.
// Returns the (a, b, depth_axis_value) tuple — the source/probe is rendered
// only if depth_axis_value == view_depth.
fn project_to_slice(vx: u32, vy: u32, vz: u32) -> vec3<u32> {
  if (u.view_axis == VIEW_AXIS_XY) { return vec3<u32>(vx, vy, vz); }
  if (u.view_axis == VIEW_AXIS_XZ) { return vec3<u32>(vx, vz, vy); }
  return vec3<u32>(vy, vz, vx);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;

  // Compute fragment's (a, b) in the slice plane and volume (i, j, k).
  var sa: u32; var sb: u32;
  var i: u32; var j: u32; var k: u32;
  if (u.view_axis == VIEW_AXIS_XY) {
    sa = clamp(u32(in.uv.x * f32(W)), 0u, W - 1u);
    sb = clamp(u32(in.uv.y * f32(H)), 0u, H - 1u);
    i = sa; j = sb; k = clamp(u.view_depth, 0u, D - 1u);
  } else if (u.view_axis == VIEW_AXIS_XZ) {
    sa = clamp(u32(in.uv.x * f32(W)), 0u, W - 1u);
    sb = clamp(u32(in.uv.y * f32(D)), 0u, D - 1u);
    i = sa; j = clamp(u.view_depth, 0u, H - 1u); k = sb;
  } else { // VIEW_AXIS_YZ
    sa = clamp(u32(in.uv.x * f32(H)), 0u, H - 1u);
    sb = clamp(u32(in.uv.y * f32(D)), 0u, D - 1u);
    i = clamp(u.view_depth, 0u, W - 1u); j = sa; k = sb;
  }

  let cell = i + j * W + k * W * H;
  let mat = material[cell];
  let bg = material_bg(mat.x, mat.y);

  var result: vec3<f32>;
  if (u.view_mode == VIEW_MAG) {
    let m = env[cell];
    let field = heat_color(sqrt(m) * MAG_GAIN);
    result = clamp(bg * 0.5 + field, vec3<f32>(0.0), vec3<f32>(1.0));
  } else {
    let v = ez[cell];
    let sgn = sign(v);
    let n = clamp(sgn * sqrt(abs(v)) * u.display_gain, -1.0, 1.0);
    let pos = max(n, 0.0);
    let neg = max(-n, 0.0);
    let field = vec3<f32>(pos, 0.06 * (pos + neg), neg);
    result = clamp(bg + field, vec3<f32>(0.0), vec3<f32>(1.0));
  }

  // Probe markers — colored ring if probe is on the active slice plane.
  let pn = u.probe_count;
  for (var p = 0u; p < pn; p = p + 1u) {
    let pos = probes[p];
    let proj = project_to_slice(pos.x, pos.y, pos.z);
    if (proj.z != u.view_depth) { continue; }
    let dx = i32(sa) - i32(proj.x);
    let dy = i32(sb) - i32(proj.y);
    let d2 = dx * dx + dy * dy;
    if (d2 >= 9 && d2 <= 20) {
      return vec4<f32>(probe_color(p), 1.0);
    }
  }

  // Source markers — cyan ring (chebyshev 3–4 cells from source center).
  let sn = u.source_count;
  for (var s = 0u; s < sn; s = s + 1u) {
    let p = sources[s].pos;
    let proj = project_to_slice(p.x, p.y, p.z);
    if (proj.z != u.view_depth) { continue; }
    let dx = i32(sa) - i32(proj.x);
    let dy = i32(sb) - i32(proj.y);
    let cheby = max(abs(dx), abs(dy));
    if (cheby == 3 || cheby == 4) {
      return vec4<f32>(0.0, 0.85, 1.0, 1.0);
    }
  }

  return vec4<f32>(result, 1.0);
}
