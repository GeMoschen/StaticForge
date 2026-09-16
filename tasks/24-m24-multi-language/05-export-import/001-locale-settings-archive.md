---
id: M24.5.1
status: todo
depends: [M24.1.1, M24.2.1]
epic: m24-multi-language
feature: export-import
area: backend
---

# M24.5.1 — Locale settings in archives, protocol bump, locale conflict analysis

## Context

`ProjectExportImportServiceImpl` (`sf-domain/.../exportimport`) writes `manifest.json`
(`ExportManifest.protocolVersion`, currently `ProjectExportImportService.PROTOCOL_VERSION
= 3`), per-asset `assets/<uuid>.json` (`ExportedAsset(uuid, type, uid, displayName,
parentFolderUuid, folderPath, templateUuid, payload, mimeType, sizeBytes, explicit)`),
`settings.json` (`ExportedSettings(channels, targets)`) and blobs. Import rejects newer
protocol versions with `ConflictType.PROTOCOL_VERSION_MISMATCH`. Payloads are copied
verbatim, so L10N wrappers already survive — but locale config does not.

## Goals

- `ExportedSettings` gains `locales` (`LocaleConfig` shape from M24.1.1); written on
  export, absent in older archives.
- Bump `PROTOCOL_VERSION` to the next free value at implementation time (M17/M19 may have
  bumped it already — check, don't assume `4`); reading older archives stays supported
  (the shape-aware reader from `M14.2.1`).
- Import settings: if the target project has **no** locales and the archive has some,
  apply the archive's locale config as part of settings import (same revision as other
  settings); if both have configs, keep the target's config.
- Conflict analysis (`analyze` and `importSettings` share one planning helper, like
  `TargetImportPlan`):
  - `LOCALE_CONFIG_MISMATCH` (WARNING): archive locales ≠ target locales — lists locales
    present only in the archive (their values will be orphaned, not lost) and only in the
    target (they'll be missing translations);
  - `LOCALIZATION_SHAPE_MISMATCH` (WARNING): an imported asset has L10N wrappers but the
    target project is non-localized (or vice versa); import keeps the payload as-is and
    the next template save / locale enablement migrates it via M24.2.2.
  - UI icon mapping for the new conflict types in
    `features/settings/project-settings-export.component.ts`.

## Acceptance criteria

- [ ] Export of a localized project writes `settings.json.locales`; import into a fresh
      project restores it and every L10N value byte-for-byte.
- [ ] Archive from protocol version 3 (no locales) still imports.
- [ ] Mismatch conflicts reported in analyze and match what import does (same helper).
- [ ] `ProjectExportImportIntegrationTest` extended; full suite green.

## Out of scope

- Converting values between locale sets on import (e.g. mapping `en-US` → `en`).

## Notes / hazards

- Don't let the importer "fix" payload shapes itself — shape migration stays owned by
  M24.2.2 so there's one migration implementation.
