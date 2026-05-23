# 0001: Stack — Vite + React + TypeScript

**Status:** Accepted
**Date:** 2026-05-23

## Decision

Use **Vite + React + TypeScript** for the web app. Deploy as a static build to Vercel.

## Context

The project is a public, browser-based EM field solver sandbox. The heavy lifting (FDTD field updates, rendering) happens in WebGPU compute and render passes. The framework's only job is the UI shell around the canvas — sliders, preset gallery, geometry painting, info panels.

Alternatives considered:

- **Vite + vanilla TS** — minimal bundle, but hand-rolling every UI control gets painful as feature count grows.
- **Vite + Svelte + TS** — smaller framework, nicer reactivity for sliders → uniforms, but smaller ecosystem and fewer WebGPU+Svelte examples to crib from.
- **Next.js + React** — first-party Vercel support, MDX for theory pages, but SSR is irrelevant; every demo is `"use client"`.
- **Astro + islands** — content-first; would be great if this becomes a teaching site with embedded demos. Tabled in case we pivot in that direction later.

## Consequences

- Vite gives fast HMR for shader iteration, and `?raw` imports for WGSL files.
- React provides a UI ecosystem (Leva, Tweakpane, Radix) without locking us into anything heavy.
- Static deploy to Vercel is one click.
- WebGPU code stays **imperative** inside `useEffect` / refs. We deliberately do **not** try to make per-cell field state "reactive" in the React sense — that lives in GPU buffers.
- Revisit if the site grows into a teaching destination — Astro becomes more attractive then.
