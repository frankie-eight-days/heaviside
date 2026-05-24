// 3D field renderer — handles all three view modes.
//   view_mode = 0 (Ez):        slice render of signed Ez (red/blue).
//   view_mode = 1 (magnitude): slice render of |E| envelope (heat ramp).
//   view_mode = 2 (volume):    ray-march the env buffer from an orbit camera.
//
// Slice + volume share the bind group; volume uses the extra camera uniform.

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

struct Camera {
  theta: f32,
  phi: f32,
  distance: f32,
  aspect: f32,
};

const VIEW_AXIS_XY: u32 = 0u;
const VIEW_AXIS_XZ: u32 = 1u;
const VIEW_AXIS_YZ: u32 = 2u;
const VIEW_EZ: u32 = 0u;
const VIEW_MAG: u32 = 1u;
const VIEW_VOLUME: u32 = 2u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ez: array<f32>;
@group(0) @binding(2) var<storage, read> env: array<f32>;
@group(0) @binding(3) var<storage, read> material: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> sources: array<Source3D>;
@group(0) @binding(5) var<storage, read> probes: array<vec4<u32>>;
@group(0) @binding(6) var<uniform> cam: Camera;

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

const MAG_GAIN: f32 = 1.6;

// Volume ray-march constants.
const VOL_FOV: f32 = 0.6;        // ~34° vertical FOV
// Step + max_steps trade: 128³ grid diagonal is ~222 cells. step=2 with
// max_steps=128 covers the diagonal at 4× less work than step=1, max=256.
// Density scales up to keep per-ray transparency roughly constant.
const VOL_MAX_STEPS: u32 = 128u;
const VOL_STEP: f32 = 2.0;
const VOL_DENSITY: f32 = 0.20;

fn heat_color(v: f32) -> vec3<f32> {
  let t = clamp(v, 0.0, 1.0);
  return vec3<f32>(
    clamp(t * 3.0, 0.0, 1.0),
    clamp(t * 3.0 - 1.0, 0.0, 1.0),
    clamp(t * 3.0 - 2.0, 0.0, 1.0),
  );
}

fn material_bg(er: f32, s: f32) -> vec3<f32> {
  if (s < 0.0) { return vec3<f32>(0.75, 0.75, 0.78); }
  let lossy_tint = vec3<f32>(0.22, 0.10, 0.06) * clamp(sqrt(s) * 1.2, 0.0, 1.6);
  let diel_tint  = vec3<f32>(0.04, 0.16, 0.24) * clamp((er - 1.0) / 3.0, 0.0, 2.0);
  return lossy_tint + diel_tint;
}

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

fn project_to_slice(vx: u32, vy: u32, vz: u32) -> vec3<u32> {
  if (u.view_axis == VIEW_AXIS_XY) { return vec3<u32>(vx, vy, vz); }
  if (u.view_axis == VIEW_AXIS_XZ) { return vec3<u32>(vx, vz, vy); }
  return vec3<u32>(vy, vz, vx);
}

fn cell_index(i: u32, j: u32, k: u32) -> u32 {
  return i + j * u.size.x + k * u.size.x * u.size.y;
}

fn sample_env(pos: vec3<f32>) -> f32 {
  let i = u32(clamp(pos.x, 0.0, f32(u.size.x - 1u)));
  let j = u32(clamp(pos.y, 0.0, f32(u.size.y - 1u)));
  let k = u32(clamp(pos.z, 0.0, f32(u.size.z - 1u)));
  return env[cell_index(i, j, k)];
}

fn sample_material(pos: vec3<f32>) -> vec2<f32> {
  let i = u32(clamp(pos.x, 0.0, f32(u.size.x - 1u)));
  let j = u32(clamp(pos.y, 0.0, f32(u.size.y - 1u)));
  let k = u32(clamp(pos.z, 0.0, f32(u.size.z - 1u)));
  return material[cell_index(i, j, k)];
}

// Ray–axis-aligned-box intersection. box_min=0, box_max=(W,H,D).
// Returns (t_enter, t_exit). t_enter > t_exit means no hit.
fn ray_box(origin: vec3<f32>, dir: vec3<f32>) -> vec2<f32> {
  let box_min = vec3<f32>(0.0);
  let box_max = vec3<f32>(f32(u.size.x), f32(u.size.y), f32(u.size.z));
  let inv_dir = 1.0 / dir;
  let t1 = (box_min - origin) * inv_dir;
  let t2 = (box_max - origin) * inv_dir;
  let tmin = min(t1, t2);
  let tmax = max(t1, t2);
  let t_enter = max(max(tmin.x, tmin.y), tmin.z);
  let t_exit = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(t_enter, t_exit);
}

fn render_volume(uv: vec2<f32>) -> vec4<f32> {
  let W = f32(u.size.x);
  let H = f32(u.size.y);
  let D = f32(u.size.z);
  let view_center = vec3<f32>(W * 0.5, H * 0.5, D * 0.5);

  let cos_phi = cos(cam.phi);
  let sin_phi = sin(cam.phi);
  let cam_pos = view_center + cam.distance * vec3<f32>(
    cos_phi * cos(cam.theta),
    sin_phi,
    cos_phi * sin(cam.theta),
  );

  let forward = normalize(view_center - cam_pos);
  let world_up = vec3<f32>(0.0, 1.0, 0.0);
  let right = normalize(cross(forward, world_up));
  let cam_up = cross(right, forward);

  let ndc = uv * 2.0 - 1.0;
  let tan_fov = tan(VOL_FOV * 0.5);
  let ray_dir = normalize(
    forward
    + right * (ndc.x * tan_fov * cam.aspect)
    - cam_up * (ndc.y * tan_fov)
  );

  let t_range = ray_box(cam_pos, ray_dir);
  let bg = vec3<f32>(0.0, 0.0, 0.05);
  if (t_range.x >= t_range.y || t_range.y < 0.0) {
    return vec4<f32>(bg, 1.0);
  }

  var t = max(t_range.x, 0.0) + 0.5;
  let t_exit = t_range.y;
  var accum = vec3<f32>(0.0);
  var alpha = 0.0;
  let scale = u.display_gain * 0.5;

  for (var n = 0u; n < VOL_MAX_STEPS; n = n + 1u) {
    if (t > t_exit || alpha > 0.95) { break; }
    let pos = cam_pos + t * ray_dir;
    let mat = sample_material(pos);
    if (mat.y < 0.0) {
      // PEC is fully opaque — write through whatever has accumulated so far
      // and break. Conductor shows as solid gray silhouette.
      accum = accum + (1.0 - alpha) * vec3<f32>(0.75, 0.75, 0.78);
      alpha = 1.0;
      break;
    }
    let env_v = sample_env(pos);
    // Adaptive step: skip 4× through cells with no detectable field. For a
    // freshly-started scene where the wave hasn't filled the grid yet, this
    // is the difference between 5 fps and 30 fps.
    if (env_v < 0.0005) {
      t = t + VOL_STEP * 4.0;
      continue;
    }
    let v = clamp(sqrt(env_v) * scale, 0.0, 1.0);
    let sample_color = heat_color(v);
    let sample_alpha = v * VOL_DENSITY;
    accum = accum + (1.0 - alpha) * sample_color * sample_alpha;
    alpha = alpha + (1.0 - alpha) * sample_alpha;
    t = t + VOL_STEP;
  }

  let final_color = accum + (1.0 - alpha) * bg;
  return vec4<f32>(final_color, 1.0);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  if (u.view_mode == VIEW_VOLUME) {
    return render_volume(in.uv);
  }

  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;

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
  } else {
    sa = clamp(u32(in.uv.x * f32(H)), 0u, H - 1u);
    sb = clamp(u32(in.uv.y * f32(D)), 0u, D - 1u);
    i = clamp(u.view_depth, 0u, W - 1u); j = sa; k = sb;
  }

  let cell = cell_index(i, j, k);
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
