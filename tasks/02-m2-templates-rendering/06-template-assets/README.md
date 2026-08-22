# Feature: Section & page template assets

**Spec:** §12 (section template), §13 (page template).
**Area:** backend. **Epic:** M2.

## Goal

Implement the section/page template domain services, channel templates, CDL-change
migration, body declarations, and their REST endpoints.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-section-template-service.md](001-section-template-service.md) | M2.1.3, M2.3.3 |
| 2 | [002-page-template-service.md](002-page-template-service.md) | 1 |
| 3 | [003-template-crosschecks.md](003-template-crosschecks.md) | 2 |

## Feature exit criteria

- [ ] Section templates hold CDL + per-channel OCTL; CDL change Migrations move renamed
      editors project-wide in one revision (§12.3).
- [ ] Page templates declare bodies/allow-lists + `outputPath`; cross-checked against
      `$CMS_BODY` occurrences (§13.2).
- [ ] Template CRUD endpoints work and compile on save.

## Dependencies

`M2:cdl`, `M2:octl`.
