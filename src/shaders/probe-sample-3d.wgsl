// 3D probe-sample. Reads Ez at each active probe's (x, y, z) cell and writes
// it into the probe's ring buffer at history_head. Same shape as the 2D probe
// pipeline so MeasurementPanel works unchanged — spectrum analyzer, VSWR, and
// phase analysis all operate on the 1D time series.

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
@group(0) @binding(1) var<storage, read> probes: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> ez: array<f32>;
@group(0) @binding(3) var<storage, read_write> history: array<f32>;

@compute @workgroup_size(8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = gid.x;
  if (p >= u.probe_count) { return; }
  let pos = probes[p];
  let cell = pos.x + pos.y * u.size.x + pos.z * u.size.x * u.size.y;
  let slot = p * u.history_len + u.history_head;
  history[slot] = ez[cell];
}
