// PML-aware Yee E-update with per-cell materials.
//
// Cells in the PML region use the precomputed PML coefficients (assume vacuum).
// Cells in the bulk consult the material grid:
//   0 (vacuum)     → Ca=1, Cb=Sc
//   1 (PEC)        → hard constraint Ezx = Ezy = 0
//   2 (lossy)      → loss coefficients from u.lossy_sigma (semi-implicit form)
//   3 (dielectric) → Cb scaled by 1/ε_r (wave slows, wavelength compresses)

struct Uniforms {
  size: vec2<u32>,
  source: vec2<u32>,
  source_value: f32,
  sc: f32,
  lossy_sigma: f32,
  dielectric_er: f32,
  pml_thickness: u32,
  _pad: u32,
};

const MAT_VACUUM: u32 = 0u;
const MAT_PEC: u32 = 1u;
const MAT_LOSSY: u32 = 2u;
const MAT_DIELECTRIC: u32 = 3u;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> ezx: array<f32>;
@group(0) @binding(2) var<storage, read_write> ezy: array<f32>;
@group(0) @binding(3) var<storage, read> hx: array<f32>;
@group(0) @binding(4) var<storage, read> hy: array<f32>;
@group(0) @binding(5) var<storage, read> pml_x: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pml_y: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> material: array<u32>;

fn idx(i: u32, j: u32) -> u32 {
  return j * u.size.x + i;
}

fn in_pml(i: u32, j: u32) -> bool {
  let t = u.pml_thickness;
  return i < t || j < t || i + t >= u.size.x || j + t >= u.size.y;
}

// Returns (Ca, Cb) for a non-PEC material.
fn material_coeffs(mat: u32) -> vec2<f32> {
  if (mat == MAT_LOSSY) {
    let s = u.lossy_sigma;
    let half_st = s * u.sc * 0.5;
    let denom = 1.0 + half_st;
    return vec2<f32>((1.0 - half_st) / denom, u.sc / denom);
  }
  if (mat == MAT_DIELECTRIC) {
    return vec2<f32>(1.0, u.sc / u.dielectric_er);
  }
  // vacuum (and PEC handled separately)
  return vec2<f32>(1.0, u.sc);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let W = u.size.x;
  let H = u.size.y;
  if (i >= W || j >= H) { return; }

  let interior = i > 0u && i + 1u < W && j > 0u && j + 1u < H;

  if (interior) {
    let k = idx(i, j);
    let curlHy = hy[k] - hy[idx(i - 1u, j)];
    let curlHx = hx[k] - hx[idx(i, j - 1u)];

    if (in_pml(i, j)) {
      let px = pml_x[i];
      let py = pml_y[j];
      ezx[k] = px.x * ezx[k] + px.y * curlHy;
      ezy[k] = py.x * ezy[k] - py.y * curlHx;
    } else {
      let mat = material[k];
      if (mat == MAT_PEC) {
        ezx[k] = 0.0;
        ezy[k] = 0.0;
      } else {
        let c = material_coeffs(mat);
        ezx[k] = c.x * ezx[k] + c.y * curlHy;
        ezy[k] = c.x * ezy[k] - c.y * curlHx;
      }
    }
  }

  // Hard sinusoidal source — wins over PEC clamp so the source stays visible
  // even if the user paints metal over it.
  if (i == u.source.x && j == u.source.y) {
    let half = u.source_value * 0.5;
    ezx[idx(i, j)] = half;
    ezy[idx(i, j)] = half;
  }
}
