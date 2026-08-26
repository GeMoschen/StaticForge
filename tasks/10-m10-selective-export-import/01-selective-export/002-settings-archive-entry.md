---
id: M10.1.2
status: todo
depends: [M10.1.1]
epic: m10-selective-export-import
feature: selective-export
area: backend
---

# M10.1.2 — Project settings archive entry

## Context

Project-level settings (`OutputChannel`s, `GenerationTarget`s) live outside the
asset/revision system entirely, so the current exporter never touches them. To export
"the project's settings" we need a new archive entry and an explicit redaction pass —
per §26.3, secrets never leave the secret manager, and a `GenerationTarget` pointed at
an S3 bucket or remote filesystem may carry connection config that counts as one.

## Goals

- New `settings.json` archive entry, written only when `includeChannels` and/or
  `includeGenerationTargets` is set on the `ExportSelection`. Shape:
  `ExportedSettings(List<ExportedChannel> channels, List<ExportedGenerationTarget> targets)`
  — each list empty/omitted per its own flag, independent of the other.
- `ExportedChannel`: channel `key`, `name`, and whatever `TemplateRef`/output-path
  config `OutputChannel` holds that is not credential material — check
  `OutputChannel`'s fields against `CreateChannelRequest`/`UpdateChannelRequest` to
  scope this precisely rather than guessing.
- `ExportedGenerationTarget`: target `type` (`FILESYSTEM | ZIP | S3`) and non-secret
  config only — for `S3`, export bucket/region/prefix but **never** access keys or
  equivalent; for `FILESYSTEM`, the path is fine (no secret there). Document exactly
  which fields are dropped in a code comment on the redaction mapper, since this is a
  security-relevant decision a future reader must not casually "fix" by adding fields
  back.
- Import side: merge, don't overwrite. A channel/target whose `key` already exists in
  the target project is left untouched and reported as a conflict (`M10.2.1`), not
  silently replaced — settings import only **adds** new keys.

## Acceptance criteria

- [ ] Exporting with both settings flags off produces an archive with no
      `settings.json` entry at all (not an empty one) — keeps whole-project exports of
      projects with no channels/targets identical to today's output.
- [ ] Exporting with `includeChannels=true` on a project with S3-backed generation
      targets never emits credential fields in `settings.json` — covered by a test that
      asserts on the redacted field set, not just "the archive parses."
- [ ] Importing `settings.json` into a project with no colliding keys creates the
      channels/targets; importing into a project where a key already exists creates
      nothing for that key and does not error (the conflict surfaces via `M10.2`,
      analysis only — this task's import path just needs to be safe to call before
      `M10.2` exists, i.e. skip-on-collision).

## Out of scope

- The conflict report UI/analysis endpoint (`M10.2`) — this task only needs import to
  not corrupt existing settings when run standalone.
- Per-field manual conflict resolution (e.g. "import this channel's name but keep my
  existing target config") — out of scope for the whole epic, not just this task.

## Notes / hazards

- Check `OutputChannel`/`GenerationTarget` and their request/view DTOs
  (`server/sf-domain/.../channel/OutputChannel.java`,
  `server/sf-domain/.../generate/GenerationTarget.java`,
  `server/sf-api/.../dto/GenerationTargetRequest.java`) for the authoritative field
  list before writing the redaction mapper — don't reconstruct it from memory of the
  spec.
- `TemplateRef` inside `OutputChannel` may reference a template asset by UUID; if that
  template isn't part of the exported asset selection, treat it the same as a
  missing-template asset conflict in `M10.2`, not a separate settings-specific case.
