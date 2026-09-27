# StaticForge — Backup & recovery runbook

Operational runbook for §26.5. Targets: PostgreSQL RPO **5 min** / RTO **1 h**, blob-store versioned backup, and a quarterly restore drill.

## Assets being backed up

| Asset | Location (compose) | Backup mechanism |
|---|---|---|
| PostgreSQL 16 | `db` service, volume `db-data` | nightly base backup + WAL archiving (PITR) |
| Media blob store | `backend` volume `media-data` → `/var/lib/staticforge/media` | versioned bucket / rsync snapshot |
| Generated output | `backend` volume `output-data` → `/var/lib/staticforge/out` | regenerable; backup optional (targets are rebuildable) |
| Search index | `backend` volume `search-index` → `/var/lib/staticforge/search-index` | **exclude** — derived from the database and rebuilt on start (M23) |

The blob store is **content-addressed** by SHA-256 (`sha/sh/sha` layout, spec §11.2), and bytes are written to the blob store *before* the transaction commits (§21.4). Consequences (§26.5):

- Blobs are immutable → incremental backup is cheap (only new SHAs are copied).
- A DB restore to an earlier point never references a missing blob. Restoring the DB before any blob sweep/GC is always safe.
- The `blob-sweep` system job (M29.2.3) deletes blobs no version references once they are older than its grace period
  (default 24 h). A DB restored to an earlier point may reference blobs swept after that point: keep blob-store
  snapshots at least as old as the grace period plus the backup interval, or run restore drills with the job disabled
  (admin Jobs page, or `sf.housekeeping.blob-sweep.enabled=false` before the first start).

## 1. PostgreSQL — nightly base + WAL (PITR)

### Prerequisites

Postgres must run with WAL archiving enabled. Reference helpers in `infra/scripts/` (owned by operations; see "helper scripts" below) wrap these `pg_basebackup`/`pg_receivewal` commands; the commands below are the canonical steps the helpers invoke.

### Nightly base backup

```sh
pg_basebackup -h db -U ${DB_USER} -D /backups/pg/base/$(date +%F) \
  -F tar -X fetch -z -P
```

Store under a versioned/rotated prefix; keep 7 daily increments plus weekly/monthly.

### Continuous WAL archiving

```sh
pg_receivewal -h db -U ${DB_USER} -D /backups/pg/wal/ --slot sf_wal --create-slot
```

Set `archive_mode=on` and `archive_command` to forward WAL to durable storage. The 5-minute RPO is the WAL archive lag, so monitor `pg_receivewal` liveness and archive latency.

## 2. Blob store — versioned bucket / rsync

For the filesystem backend, rsync the media root nightly:

```sh
rsync -a --delete-after /var/lib/staticforge/media/ /backups/media/current/
```

Because blobs are immutable and SHA-addressed, this is an incrementing copy. If using `S3BlobStore`, enable bucket versioning instead and skip rsync.

## 3. Restore / PITR procedure (RTO 1 h)

1. **Stop the backend** so no generation/save is mid-flight (`docker compose stop backend`).
2. **Restore the base backup** to a fresh data directory.
3. **Replay WAL to the desired point in time** (`recovery_target_time` in `postgresql.conf` recovery settings), or to latest.
4. **Verify** the blob store is present (it is not touched by the DB restore; content-addressing guarantees consistency).
5. **Restart** the stack; `backend` runs Liquibase on startup and only turns healthy when migrations succeed (`infra/docker/docker-compose.yml` healthcheck, spec §26.6).
6. **Smoke-test** login and one page read/write.

Rolling back a *hard-deleted* asset is a normal restore because deletes are soft (`deleted=true` version rows) — you rarely need PITR for content; use revision restore (`POST /assets/{uuid}/restore` or project-wide `POST /restore`) instead. Reserve PITR for schema/database-level incidents.

## 4. Quarterly restore drill

1. Pick a date and a PITR target (e.g. "one hour before last week's Thursday run").
2. Restore to an isolated environment per section 3.
3. Verify: revision count matches expectation; read N assets at N revisions; generate one page and diff against the recorded output.
4. Record RTO actually achieved and any gaps; update this runbook.

## 5. Helper scripts (expected under `infra/scripts/`)

Operations is expected to provide (and the runbook references):

- `pg-backup.sh` — wraps the nightly `pg_basebackup` and rotates retention.
- `pg-wal-archive.sh` / a `pg_receivewal` service unit — keeps WAL archiving alive.
- `media-backup.sh` — the rsync (or bucket-versioning toggle) for the blob store.
- `restore-drill.sh` — the isolated restore + verify flow (section 4).

**Note:** `infra/scripts/` does not yet exist in the repository; create these as part of operationalizing this runbook. The runbook's commands are canonical regardless of where the helpers land.

## 6. Search index after a restore

Don't back up or restore the search index. After a database restore, start the backend as usual: each project's index
records the database state it was built from (project key and creation time) and its revision stamp, so an index that
belongs to another database, is ahead of the restored database, or is missing is rebuilt in the background at start.
To start clean anyway, delete the `search-index` volume before starting.

## 7. Consistency reminder

Order matters and is guaranteed by the code (§21.4): media bytes hit the blob store **before** commit, and orphaned blobs (from a failed commit) are collected by the nightly sweep — never the reverse. Never run the blob sweep against a restored database that points at revisions newer than the restore target; if in doubt, skip the sweep.
