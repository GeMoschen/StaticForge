---
id: M4.2.1
status: done
depends: [M4.1.2, M2.4.2]
epic: m4-generation
feature: render-pipeline
area: backend
---

# M4.2.1 — Parallel render task

## Context

Implement §18.2 stages 3–4: compile+validate everything needed, then render in parallel.

## Goals

- Implement the **VALIDATE** stage: compile every needed template, resolve refs, run
  content validation; ERROR-severity findings abort before any file is written.
- Implement the **RENDER** stage: `RenderTask` per (page, channel) producing rendered
  bytes + dependency set, executed in parallel over virtual threads bounded by
  `sf.generate.parallelism`.
- Keep rendering deterministic (dependency sets feed `asset_reference`).

## Acceptance criteria

- [ ] A validation error aborts the run before any write.
- [ ] Pages render in parallel with bounded concurrency and identical output to serial.

## Out of scope

- ASSETS/POST/WRITE (features 3+4).

## Notes / hazards

- Reuse the renderer's thread-safety guarantees (§16.10).
