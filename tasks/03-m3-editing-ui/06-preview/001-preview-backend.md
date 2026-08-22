---
id: M3.6.1
status: done
depends: [M2.4.2, M3.5.2]
epic: m3-editing-ui
feature: preview
area: backend
---

# M3.6.1 — Preview backend (render + sandbox)

## Context

Implement §19.1 modes and §19.2 mechanics: same render engine, no second code path.

## Goals

- Implement `PreviewService` for `POST /preview/page` (live, unsaved payload),
  `GET /preview/pages/{uuid}` (saved), `?revision=` (past), `POST /preview/section`,
  `?channel=` (non-HTML rendered as highlighted text).
- Sandboxed route: `Content-Security-Policy: sandbox allow-scripts allow-same-origin`,
  `X-Frame-Options` allow app origin, per-request nonce.
- Rewrite `$CMS_REF` targets to preview URLs (`/api/v1/projects/{p}/preview/pages/{uuid}`)
  with a "preview link rewriting" toggle (§19.2).
- Live preview debounced 400 ms, cancellable; unsaved payload never persisted.

## Acceptance criteria

- [ ] Preview renders via the compiled template path (proven by a test reusing render).
- [ ] CSP sandbox + nonce + frame-ancestors are enforced on preview output.

## Out of scope

- The frontend iframe (next task).

## Notes / hazards

- Media refs resolve to the live media endpoint so unpublished images appear (§19.2).
