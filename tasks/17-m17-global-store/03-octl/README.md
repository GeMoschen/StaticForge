# Feature: Global values in OCTL

**Spec:** Extends §16.2 (instructions), §16.4 (reference syntax `assetType:uid`), §16.5
(scopes), §18.1 (incremental generation scope), §19 (preview).

## Goal

Let channel templates read property-set values in two equivalent forms:

```
$CMS_VALUE(global:site.title)$                  explicit cross-asset reference (§16.4)
$CMS_VALUE(CMS_GLOBAL.site.title)$              shorthand accessor root, like CMS_PAGE (§16.5)
$CMS_IF(CMS_GLOBAL.site.showBanner)$ … $CMS_END_IF$
$CMS_REF(CMS_GLOBAL.site.logo)$                 media/link editors inside a set resolve URLs
$CMS_FOR(link : CMS_GLOBAL.social.links)$ … $CMS_END_FOR$
```

Both forms resolve at compile time to the set's UUID, fail with `SF-TPL-0110` when the
set doesn't exist, record the dependency, and render through the `M16.2` cross-asset value
resolver: snapshot values in generation, live values in preview.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-global-prefix-and-scope.md](001-global-prefix-and-scope.md) | `M17.1.2`, `M16.2.2`, `M16.3.2` |

## Feature exit criteria

- [ ] Both syntaxes render correctly in generation and preview, and golden tests cover them.
- [ ] A value change in a set triggers re-rendering of exactly the dependent pages in an
      `INCREMENTAL` run.

## Dependencies

`M16.2` (cross-asset values), `M16.3.2` (template OCTL references written on save),
`M16.3.3` (revision-aware references used by `BuildPlanner`), `M17.1` (domain).
