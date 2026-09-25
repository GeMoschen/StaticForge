---
id: M29.3.2
status: todo
depends: [M29.1.1]
epic: m29-housekeeping-jobs
feature: extended-jobs
area: backend
---

# M29.3.2 — Derived media variants and variant backfill

## Context

- `MediaServiceImpl.generateVariants` (`:495-522`, synchronous; `webp` skipped; a failed encode is logged at `:536`)
  and `storeBlob`.
- `MediaProperties.variants` (`sf.media.variants`, instance-wide).
- The payload-variant readers: `MediaController:489`, `MediaServiceImpl:348`,
  `ProjectExportImportServiceImpl:1156,1277`, `GenerationRenderer:478`, `AssetCopyStage:108`.
- M27 localized media (per-locale files: variants per file) and M27 release state (a payload rewrite would create a
  `CHANGED` draft).
- Epic decision 10.

## Goals

- **Table `media_variant`** (changeset in `024-system-jobs.xml`):
  - columns `id`, `source_sha`, `name`, `width`, `format`, `quality`, `blob_sha`, `created_at`;
  - unique on `(source_sha, name, width, format, quality)`;
  - variants are a pure function of source bytes and definition, so they are project-independent and shared across
    projects like blobs.
- **`MediaVariantResolver`** (sf-domain): `variantsFor(payload[, locale])` returns the payload's variants merged with
  the table rows for the current policy, where the payload wins on the same name. All five readers switch to it, and
  export writes the merged list.
- **Upload keeps its behaviour** (payload variants), and also records the rows it creates in `media_variant`
  (idempotent), so the backfill sees them as present.
- **Job `media-variant-backfill`** (default `0 2 * * *`, settings `maxPerRun` = 500, `includeHistorical` = false):
  - for every current (open) media version's source blob (and every localized file), for every variant definition in
    the current policy that applies (raster image, `appliesTo`), where neither the payload nor the table has it:
    encode, `storeBlob`, insert the row;
  - with `includeHistorical`, also closed versions (so rebuilding old revisions gets variants);
  - encoder failures are counted and reported per mime type and definition, and retried on the next run;
  - still-missing encoders (`webp` today) are reported once as "unsupported format", not per asset.
- The report lists the variants created, failures by reason and unsupported definitions.

## Acceptance criteria

- [ ] A media asset uploaded while the policy had one definition gets the second definition's variant from the
      backfill after a policy change. No revision is created (the revision counter is unchanged) and the M27 release
      status stays `PUBLISHED`.
- [ ] Generation copies and references the backfilled variant (`$CMS_REF(media:x, variant=…)` or whatever the existing
      syntax is). Preview uses it.
- [ ] A simulated encode failure is reported and retried next run, with no crash.
- [ ] Export includes merged variants. Import of an archive produced before this task still works.
- [ ] Blob sweep marks `media_variant` blobs (coordinate with `M29.2.3`, whichever lands second adds the test).
- [ ] `./gradlew build` green.

## Out of scope

- A per-project variant policy (spec §11.4). Noted in the spec follow-up.
- A `webp` encoder.

## Notes / hazards

- Revision invariants: reading a media version at revision R must stay byte-identical. `media_variant` is outside the
  version payload, so this holds. Don't add variants to payloads from the job.
- Removing a definition from the policy doesn't delete rows. The resolver filters by the current policy, and the blob
  sweep keeps the rows' blobs as long as the rows exist. A row cleanup for removed definitions is a follow-up; note it
  in the Javadoc.
