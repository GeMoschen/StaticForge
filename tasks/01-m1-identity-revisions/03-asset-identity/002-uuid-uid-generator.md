---
id: M1.3.2
status: done
depends: [M1.3.1]
epic: m1-identity-revisions
feature: asset-identity
area: backend
---

# M1.3.2 — UUIDv7 & UID derivation

## Context

Implement identity generation per §6.1 (UUIDv7) and §6.3 (UID derivation algorithm).

## Goals

- Generate UUIDv7 (time-ordered) at creation, immutable (#6.1).
- Implement `deriveUid(displayName, projectId, assetType)` exactly per §6.3: NFKD
  normalize + strip combining marks, transliterate (`ß`→`ss`, `æ`→`ae`), lowercase,
  collapse non-`[a-z0-9]` runs to `_`, trim, truncate to 96 (cut at last `_` if ≤12 lost),
  fallback to type, reserved-word append `_1` (`new,edit,index,api,preview,_generated`),
  uniqueness probe `base`,`base_1`,… bounded at 10,000 then random suffix.
- Implement the uniqueness allocation inside the insert transaction with bounded retry
  (5 attempts) on constraint violation (§6.5).

## Acceptance criteria

- [ ] `deriveUid` reproduces the full §6.3 example table exactly (incl. `!!!`→`page`,
      cross-type no-clash, `uber_uns_1/_2`).
- [ ] Concurrent creation of identically-named assets yields unique UIDs with no gap/error.
- [ ] UUIDs are v7 time-ordered.

## Out of scope

- UID rename (next task).

## Notes / hazards

- Normalization must be deterministic and locale-independent; unit-test the regex/NFKD
  edge cases heavily (property-based via jqwik is planned in feature 7).
