// PML-aware Yee E-update for 2D TMz with Berenger split fields.
//
// Ezx is driven by  ∂Hy/∂x and damped by σx (x-direction PML).
// Ezy is driven by -∂Hx/∂y and damped by σy (y-direction PML).
// Physical Ez = Ezx + Ezy.
//
// In the bulk (σx = σy = 0) the updates reduce to the standard FDTD form
// from M2. Inside a PML region the leading multiplier (Ca = exp(-σΔt))
// damps the field; in a corner both components are damped.
//
// PEC walls remain at i=0, i=W-1, j=0, j=H-1 (Ezx = Ezy = 0). With the PML
// absorbing the wave first, any residual that reaches the wall is tiny.

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ezx: array<f32>;
@group(0) @binding(2) var<storage, read_write> ezy: array<f32>;
@group(0) @binding(3) var<storage, read> hx: array<f32>;
@group(0) @binding(4) var<storage, read> hy: array<f32>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;

fn idx(i: u32, j: u32) -> u32 {
  return j * u.size.x + i;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }

  if (i > 0u && i + 1u < W && j > 0u && j + 1u < H) {
    let px = pml_x[i];
    let py = pml_y[j];
    let curlHy = hy[idx(i, j)] - hy[idx(i - 1u, j)];
    let curlHx = hx[idx(i, j)] - hx[idx(i, j - 1u)];
    ezx[idx(i, j)] = px.x * ezx[idx(i, j)] + px.y * curlHy;
    ezy[idx(i, j)] = py.x * ezy[idx(i, j)] - py.y * curlHx;
  }

  // Hard sinusoidal source — split evenly between the two components.
  if (i == u.source.x && j == u.source.y) {
    let half = u.source_value * 0.5;
    ezx[idx(i, j)] = half;
    ezy[idx(i, j)] = half;
  }
}
