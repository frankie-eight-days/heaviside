// Field renderer — instantaneous Ez (red/blue) or time-averaged magnitude
// envelope (heat ramp). Overlays material tint and a source-position marker.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
  pml_thickness: u32,
  view_mode: u32,
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
// sqrt compression in magnitude view: faint scattered/diffracted fields
// (env ≈ 0.01) become visible without the bright source area pegging white.
const MAG_GAIN: f32 = 1.6;

fn material_bg(er: f32, s: f32, pec: bool) -> vec3<f32> {
  if (pec) { return vec3<f32>(0.75, 0.75, 0.78); }
  let lossy_tint = vec3<f32>(0.22, 0.10, 0.06) * clamp(sqrt(s) * 1.2, 0.0, 1.6);
  let diel_tint  = vec3<f32>(0.04, 0.16, 0.24) * clamp((er - 1.0) / 3.0, 0.0, 2.0);
  return lossy_tint + diel_tint;
}

// Black → red → yellow → white heat ramp for magnitude view.
fn heat_color(v: f32) -> vec3<f32> {
  let t = clamp(v, 0.0, 1.0);
  return vec3<f32>(
    clamp(t * 3.0, 0.0, 1.0),
    clamp(t * 3.0 - 1.0, 0.0, 1.0),
    clamp(t * 3.0 - 2.0, 0.0, 1.0),
  );
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

  // Source marker: 2-cell-thick cyan ring. Cyan contrasts both the red/blue Ez
  // colormap and the red/yellow/white heat ramp, so the source stays visible
  // in either view mode and at any source state.
  let dx = i32(i) - i32(u.source.x);
  let dy = i32(j) - i32(u.source.y);
  let cheby = max(abs(dx), abs(dy));
  if (cheby == 3 || cheby == 4) {
    return vec4<f32>(0.0, 0.85, 1.0, 1.0);
  }

  return vec4<f32>(result, 1.0);
}
