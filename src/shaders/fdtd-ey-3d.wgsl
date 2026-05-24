// 3D FDTD Ey update with CPML (M9b).
//   ε ∂Ey/∂t = (1/κ_z) ∂Hx/∂z − (1/κ_x) ∂Hz/∂x + ψE_y_z − ψE_y_x
// ψ pack: .x = ψ_z, .y = ψ_x

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

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ey: array<f32>;
@group(0) @binding(2) var<storage, read> hx: array<f32>;
@group(0) @binding(3) var<storage, read> hz: array<f32>;
@group(0) @binding(4) var<storage, read_write> psi_ey: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> pml_z: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> material: array<vec2<f32>>;

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
  if (k < 1u || i < 1u) { return; }

  let cell = idx(i, j, k);
  let mat = material[cell];
  if (mat.y < 0.0) {
    ey[cell] = 0.0;
    return;
  }

  let curlHx = hx[idx(i, j, k)] - hx[idx(i, j, k - 1u)];
  let curlHz = hz[idx(i, j, k)] - hz[idx(i - 1u, j, k)];

  let pz = pml_z[k];
  let px = pml_x[i];

  var psi = psi_ey[cell];
  psi.x = pz.x * psi.x + pz.y * curlHx;
  psi.y = px.x * psi.y + px.y * curlHz;
  psi_ey[cell] = psi;

  let er = mat.x;
  let loss = mat.y * u.sc / (2.0 * er);
  let denom = 1.0 + loss;
  let ca = (1.0 - loss) / denom;
  let cb = (u.sc / er) / denom;
  ey[cell] = ca * ey[cell] + cb * (curlHx - curlHz + psi.x - psi.y);
}
