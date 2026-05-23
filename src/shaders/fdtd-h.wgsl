// PML-aware Yee H-update for 2D TMz with Berenger split fields.
// Ez is split into Ezx + Ezy; the bulk Ez seen by H equals their sum.
// Hx is damped by σy (the y-direction PML conductivity).
// Hy is damped by σx (the x-direction PML conductivity).

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ezx: array<f32>;
@group(0) @binding(2) var<storage, read> ezy: array<f32>;
@group(0) @binding(3) var<storage, read_write> hx: array<f32>;
@group(0) @binding(4) var<storage, read_write> hy: array<f32>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;

fn idx(i: u32, j: u32) -> u32 {
  return j * u.size.x + i;
}

fn ez_at(i: u32, j: u32) -> f32 {
  let k = idx(i, j);
  return ezx[k] + ezy[k];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }

  // Hx[i, j+1/2] uses σy at half-cell j+1/2 → pml_y[j].zw
  if (j + 1u < H) {
    let py = pml_y[j];
    let curl = ez_at(i, j + 1u) - ez_at(i, j);
    hx[idx(i, j)] = py.z * hx[idx(i, j)] - py.w * curl;
  }

  // Hy[i+1/2, j] uses σx at half-cell i+1/2 → pml_x[i].zw
  if (i + 1u < W) {
    let px = pml_x[i];
    let curl = ez_at(i + 1u, j) - ez_at(i, j);
    hy[idx(i, j)] = px.z * hy[idx(i, j)] + px.w * curl;
  }
}
