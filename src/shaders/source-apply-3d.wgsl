// 3D source-apply. Each source has an xyz polarization byte; the shader
// writes the source value into the matching E component at the source cell.
// pol encoding: 1=x, 2=y, 3=z (and 0 → z as the default for 3D scenes).

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

struct Source3D {
  pos: vec3<u32>,
  pol: u32,
  value: f32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> sources: array<Source3D>;
@group(0) @binding(2) var<storage, read_write> ex: array<f32>;
@group(0) @binding(3) var<storage, read_write> ey: array<f32>;
@group(0) @binding(4) var<storage, read_write> ez: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  if (s >= u.source_count) { return; }
  let src = sources[s];
  let k = src.pos.x + src.pos.y * u.size.x + src.pos.z * u.size.x * u.size.y;
  let pol = src.pol;
  if (pol == 1u) {
    ex[k] = src.value;
  } else if (pol == 2u) {
    ey[k] = src.value;
  } else {
    // pol == 3u (z) or pol == 0u (default) → drive Ez
    ez[k] = src.value;
  }
}
