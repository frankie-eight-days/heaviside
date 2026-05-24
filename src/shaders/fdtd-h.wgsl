// PML-aware Yee H-update for 2D TMz. Uniform struct matches the rest of the
// pipelines (same uniform buffer is bound to all of them).

struct Uniforms {
  size: vec2<u32>,
  source_count: u32,
  pml_thickness: u32,
  sc: f32,
  view_mode: u32,
  _pad: vec2<u32>,
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

  if (j + 1u < H) {
    let py = pml_y[j];
    let curl = ez_at(i, j + 1u) - ez_at(i, j);
    hx[idx(i, j)] = py.z * hx[idx(i, j)] - py.w * curl;
  }

  if (i + 1u < W) {
    let px = pml_x[i];
    let curl = ez_at(i + 1u, j) - ez_at(i, j);
    hy[idx(i, j)] = px.z * hy[idx(i, j)] + px.w * curl;
  }
}
