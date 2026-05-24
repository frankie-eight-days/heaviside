// 3D FDTD Ez update with CPML (M9b).
//   ε ∂Ez/∂t = (1/κ_x) ∂Hy/∂x − (1/κ_y) ∂Hx/∂y + ψE_z_x − ψE_z_y
// ψ pack: .x = ψ_x, .y = ψ_y

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
@group(0) @binding(1) var<storage, read_write> ez: array<f32>;
@group(0) @binding(2) var<storage, read> hy: array<f32>;
@group(0) @binding(3) var<storage, read> hx: array<f32>;
@group(0) @binding(4) var<storage, read_write> psi_ez: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;
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
  if (i < 1u || j < 1u) { return; }

  let cell = idx(i, j, k);
  let mat = material[cell];
  if (mat.y < 0.0) {
    ez[cell] = 0.0;
    return;
  }

  let curlHy = hy[idx(i, j, k)] - hy[idx(i - 1u, j, k)];
  let curlHx = hx[idx(i, j, k)] - hx[idx(i, j - 1u, k)];

  let px = pml_x[i];
  let py = pml_y[j];

  var psi = psi_ez[cell];
  psi.x = px.x * psi.x + px.y * curlHy;
  psi.y = py.x * psi.y + py.y * curlHx;
  psi_ez[cell] = psi;

  let er = mat.x;
  let loss = mat.y * u.sc / (2.0 * er);
  let denom = 1.0 + loss;
  let ca = (1.0 - loss) / denom;
  let cb = (u.sc / er) / denom;
  ez[cell] = ca * ez[cell] + cb * (curlHy - curlHx + psi.x - psi.y);
}
