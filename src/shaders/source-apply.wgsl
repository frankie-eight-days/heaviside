// Source-apply compute pass. Runs once per timestep, after the E pass,
// before the envelope pass. Writes per-source values into ezx/ezy at the
// source cells, overriding whatever the E pass just computed.
//
// See docs/decisions/0006. JS computes per-source values from
// (stepCount, mode, period, phase, amplitude) each step and uploads the
// sources buffer with writeBuffer.

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

struct Source {
  pos: vec2<u32>,
  value: f32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> sources: array<Source>;
@group(0) @binding(2) var<storage, read_write> ezx: array<f32>;
@group(0) @binding(3) var<storage, read_write> ezy: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  if (s >= u.source_count) { return; }
  let src = sources[s];
  let k = src.pos.y * u.size.x + src.pos.x;
  let half = src.value * 0.5;
  ezx[k] = half;
  ezy[k] = half;
}
