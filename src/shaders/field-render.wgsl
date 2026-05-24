// Field renderer — instantaneous Ez (red/blue) or time-averaged magnitude
// envelope (heat ramp). Overlays material tint, cyan source-position rings,
// and white probe-position rings.

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

struct Source {
  pos: vec2<u32>,
  value: f32,
  _pad: u32,
};

const FLAG_PEC: u32 = 1u;
const VIEW_EZ: u32 = 0u;
const VIEW_MAG: u32 = 1u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ezx: array<f32>;
@group(0) @binding(2) var<storage, read> ezy: array<f32>;
@group(0) @binding(3) var<storage, read> material: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> flags: array<u32>;
@group(0) @binding(5) var<storage, read> env: array<f32>;
@group(0) @binding(6) var<storage, read> sources: array<Source>;
@group(0) @binding(7) var<storage, read> probes: array<vec2<u32>>;

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

fn material_bg(er: f32, s: f32, pec: bool) -> vec3<f32> {
  if (pec) { return vec3<f32>(0.75, 0.75, 0.78); }
  let lossy_tint = vec3<f32>(0.22, 0.10, 0.06) * clamp(sqrt(s) * 1.2, 0.0, 1.6);
  let diel_tint  = vec3<f32>(0.04, 0.16, 0.24) * clamp((er - 1.0) / 3.0, 0.0, 2.0);
  return lossy_tint + diel_tint;
}

fn heat_color(v: f32) -> vec3<f32> {
  let t = clamp(v, 0.0, 1.0);
  return vec3<f32>(
    clamp(t * 3.0, 0.0, 1.0),
    clamp(t * 3.0 - 1.0, 0.0, 1.0),
    clamp(t * 3.0 - 2.0, 0.0, 1.0),
  );
}

fn is_source_marker(i: u32, j: u32) -> bool {
  let n = u.source_count;
  for (var s = 0u; s < n; s = s + 1u) {
    let p = sources[s].pos;
    let dx = i32(i) - i32(p.x);
    let dy = i32(j) - i32(p.y);
    let cheby = max(abs(dx), abs(dy));
    if (cheby == 3 || cheby == 4) {
      return true;
    }
  }
  return false;
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

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let W = u.size.x;
  let H = u.size.y;
  let coord = in.uv * vec2<f32>(f32(W), f32(H));
  let i = clamp(u32(coord.x), 0u, W - 1u);
  let j = clamp(u32(coord.y), 0u, H - 1u);
  let k = j * W + i;

  let pec = (flags[k] & FLAG_PEC) != 0u;
  let mat = material[k];
  let bg = material_bg(mat.x, mat.y, pec);

  var result: vec3<f32>;
  if (u.view_mode == VIEW_MAG) {
    let m = env[k];
    let field = heat_color(sqrt(m) * MAG_GAIN);
    result = clamp(bg * 0.5 + field, vec3<f32>(0.0), vec3<f32>(1.0));
  } else {
    let v = ezx[k] + ezy[k];
    let n = clamp(v * DISPLAY_GAIN, -1.0, 1.0);
    let pos = max(n, 0.0);
    let neg = max(-n, 0.0);
    let field = vec3<f32>(pos, 0.06 * (pos + neg), neg);
    result = clamp(bg + field, vec3<f32>(0.0), vec3<f32>(1.0));
  }

  // Probe markers — colored ring per probe, color matches MeasurementPanel.
  let pn = u.probe_count;
  for (var p = 0u; p < pn; p = p + 1u) {
    let pos = probes[p];
    let dx = i32(i) - i32(pos.x);
    let dy = i32(j) - i32(pos.y);
    let d2 = dx * dx + dy * dy;
    if (d2 >= 9 && d2 <= 20) {
      return vec4<f32>(probe_color(p), 1.0);
    }
  }
  if (is_source_marker(i, j)) {
    return vec4<f32>(0.0, 0.85, 1.0, 1.0);
  }

  return vec4<f32>(result, 1.0);
}
