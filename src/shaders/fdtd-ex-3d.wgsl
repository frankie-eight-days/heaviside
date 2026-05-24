// 3D FDTD Ex update with CPML on all six faces (M9b). Vacuum, no per-cell
// materials (M9c). κ-stretching is hardcoded to 1 in this simplified CPML
// (σ-only); the math leaves κ in place so the shader stays correct if we
// enable stretching later.
//
//   ε ∂Ex/∂t = (1/κ_y) ∂Hz/∂y − (1/κ_z) ∂Hy/∂z + ψE_x_y − ψE_x_z
// ψ recurrence:
//   ψE_x_y[n+1] = b_y · ψE_x_y[n] + a_y · ∂Hz/∂y
//   ψE_x_z[n+1] = b_z · ψE_x_z[n] + a_z · ∂Hy/∂z
//
// ψ pair packed per-cell as vec2<f32>(.x = ψ_y, .y = ψ_z). Outside the PML
// region b=1, a=0 — ψ stays at its prior value (zero from reset) and the
// recurrence is a no-op.

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

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ex: array<f32>;
@group(0) @binding(2) var<storage, read> hz: array<f32>;
@group(0) @binding(3) var<storage, read> hy: array<f32>;
@group(0) @binding(4) var<storage, read_write> psi_ex: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> pml_y: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_z: array<vec4<f32>>;

fn idx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * u.size.x + k * u.size.x * u.size.y;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;
  let W = u.size.x;
  let H = u.size.y;
  let D = u.size.z;
  if (i >= W || j >= H || k >= D) { return; }
  if (j < 1u || k < 1u) { return; }  // curl needs j-1 and k-1

  let curlHz = hz[idx(i, j, k)] - hz[idx(i, j - 1u, k)];
  let curlHy = hy[idx(i, j, k)] - hy[idx(i, j, k - 1u)];

  // pml axis coefs at the E-position (.x = b_E, .y = a_E, .z/.w = H coefs).
  // κ would live alongside but is fixed at 1 in this simplified CPML.
  let py = pml_y[j];
  let pz = pml_z[k];

  let cell = idx(i, j, k);
  var psi = psi_ex[cell];
  // ψ recurrence — uses curl values from the just-updated H field.
  psi.x = py.x * psi.x + py.y * curlHz;
  psi.y = pz.x * psi.y + pz.y * curlHy;
  psi_ex[cell] = psi;

  ex[cell] = ex[cell] + u.sc * (curlHz - curlHy + psi.x - psi.y);
}
