// TEz probe-sample. Samples Hz (the signed out-of-page scalar, dual of Ez
// in TMz) so the spectrum analyzer, VSWR, and phase analysis pipelines
// work polarization-agnostically.

struct Uniforms {
  size: vec2<u32>,
  source_count: u32,
  pml_thickness: u32,
  sc: f32,
  view_mode: u32,
  probe_count: u32,
  history_head: u32,
  history_len: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> probes: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read> hzx: array<f32>;
@group(0) @binding(3) var<storage, read> hzy: array<f32>;
@group(0) @binding(4) var<storage, read_write> history: array<f32>;

@compute @workgroup_size(8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = gid.x;
  if (p >= u.probe_count) { return; }
  let pos = probes[p];
  let k = pos.y * u.size.x + pos.x;
  let hz = hzx[k] + hzy[k];
  let slot = p * u.history_len + u.history_head;
  history[slot] = hz;
}
