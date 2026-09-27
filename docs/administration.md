# StaticForge — Administration guide

For instance administrators: accounts, sign-in problems, archiving projects and housekeeping jobs — and, for project
admins, what editors may publish. Everything here is under
**Administration** in the user menu (top right on the dashboard, bottom of the project rail); only instance
administrators see it. The rules behind it are in `cms-specification.md` §8.1–§8.3 and §9.2; operator setup (the
seeded `Admin` account, password policy settings) is in [`infra/README.md`](../infra/README.md).

## Who can do what

| | Instance admin | Project admin | Everyone |
|---|---|---|---|
| Create, edit, disable, delete accounts | ✅ | — | — |
| Grant or revoke instance administration | ✅ | — | — |
| Add existing accounts to a project, change roles, remove members | ✅ (every project) | ✅ (their project) | — |
| See who is in a project | ✅ | ✅ (with emails) | ✅ (members, without emails) |
| Choose what editors may publish (publish policy, M28) | ✅ (every project) | ✅ (their project) | read-only (members) |
| Turn on revision compaction for a project (M29) | ✅ (every project) | ✅ (their project) | read-only (members) |
| Housekeeping jobs: schedules, settings, run now (M29) | ✅ | — | — |
| Archive and unarchive projects, read the whole audit trail | ✅ | — | — |
| Change own profile and password, sign out everywhere | ✅ | ✅ | ✅ |

Instance admins can open every project as a project admin without being a member, and aren't listed as members.

## Creating a user

**Administration → Users → New user.** Enter username, email and (optionally) a display name, tick **Instance
administrator** if needed, and choose the password:

- **Generate a password** (default) — the server generates one that meets the password policy. It is shown **once**,
  right after creating the account: copy it and hand it to the user yourself. StaticForge sends no email.
- **Set a password** — type one; the policy's rules show as live checks.

**Must change password at the next sign-in** is on by default: the user then sees only a "Set a new password" screen
until they choose their own. Leave it on for any password you know.

Optionally add the first **projects** with a role each; more can be added later on the user's page or by a project
admin in the project's **Settings → Members** tab.

## Everyday account tasks

Open a user from the list (search by username, name or email; filter by status and role).

| Task | What happens |
|---|---|
| **Edit the profile** | Username, email and display name; usernames and emails must be unique. Sessions stay signed in. |
| **Reset password** | Generate or set a new temporary password (shown once when generated). Every session of the user is signed out; by default they must choose a new password at the next sign-in. |
| **Unlock** | Shown when the account is locked after 15 failed sign-ins (the lock also lifts by itself after 30 minutes). |
| **Sign out everywhere** | Ends every session of the user, on every device. Use it when a device is lost. |
| **Make / revoke instance admin** | Takes effect on the user's next request; their sessions are signed out. |
| **Project memberships** | Add the user to projects, change roles, remove them. Memberships of archived projects are read-only. |

Users change their own profile and password, and can sign out everywhere, under **My account** in the user menu.

## Disable or delete?

- **Disable** when someone should lose access for now (leave, suspicion, offboarding in progress). Sign-in is refused
  and every session ends at once; their memberships stay, so **Enable** restores everything as it was.
- **Delete** when the account should be gone for good. Deleting **anonymizes** it: username, email and display name
  are removed, every membership and session ends, and history shows the account as *Deleted user*. Revisions and audit
  entries stay. **This can't be undone** — to confirm, type the username.

Guard rails: you can't disable, delete or demote yourself, and the last active instance admin can't be disabled,
deleted or demoted — create another instance admin first. The buttons are disabled with the reason.

## Changes take effect immediately

Role changes, removals, disabling, deleting, password resets and archiving apply on the affected user's **next
request** — no waiting for a token to expire. For a removal the project simply disappears for them; for a disable or
delete they land on the sign-in page.

## Archiving a project

**Administration → Projects → Archive.** An archived project:

- disappears for its members — from their dashboard and from every link (they get "not found"); their memberships stay;
- is read-only for everyone, instance admins included: every edit control is disabled, a banner says the project is
  archived, and the server refuses any change;
- starts no generation runs and creates no share links; share links created earlier stop working; the published site
  is left as it is;
- executes no schedules (M27): a scheduled release or build that comes due while the project is archived waits, and
  after unarchiving runs late or is skipped, as its *If the time is missed* option says.

**Unarchive** (on the Projects tab, or from the banner inside the project) makes it writable and visible again, with
everyone's old role.

## Letting editors publish (M28)

Since M27 a change goes online when it is **released** and then **built**. By default only developers (and project
admins) do either. Each project can open these steps to its **editors** — a project decision, made by its project
admins (or an instance admin) under **Settings → Generation → Publishing by editors**:

| Switch | Editors may then | Needs |
|---|---|---|
| **Release, discard and unpublish content** | release their changes, discard drafts, take content offline | — |
| **Schedule releases and unpublishing** | schedule one-off releases and unpublishing, and change their own schedules | Release |
| **Start incremental builds to the default target** | build what changed (or a folder or some pages) to the default target, *Build now* after a release, cancel their own builds | — |
| **Start full builds and builds to any target** | full builds, and builds to any target | Incremental builds |

**Choosing a policy.** All four are off in every project, including projects that existed before the upgrade, so
nothing changes until you opt in. A common choice for a small team is *Release* plus *Incremental builds*: editors put
a text change online without waiting for anyone. Keep *Full builds* for teams where editors know when a whole-site
rebuild or a second target is appropriate. A switch that needs another is disabled until that one is on, and turning
the other off turns it off too. Members who aren't project admins see the card read-only.

**What developers keep.** Developers and project admins can always do all four, whatever the card says. These stay
with developers in every project: **Promote** (rolling back to an earlier build), builds of an earlier revision,
scheduled and repeating builds, changing or cancelling other people's schedules and builds, and the targets (creating
them needs a developer, editing and deleting a project admin). Viewers never publish.

**When it applies.** A change applies to every editor's **next request** — nobody signs out, and open browser tabs
adjust on the next click or when the tab is shown again. Each change is recorded as a project revision and in the
audit trail (`PUBLISH_POLICY_SET`, with the policy before and after). The revision history can't show an earlier
policy; the audit trail can.

**The impact warning.** Before saving, the card checks what the new policy would break: pending schedules owned by
editors that would lose a permission they need (for example a scheduled release after you turn off *Schedule
releases*). If there are any, a dialog lists them — type, time, owner and the missing permission — with **Save
anyway** or **Cancel**. Saved anyway, those schedules fail when they come due ("Owner no longer permitted", see
below); a developer can take them over.

## Schedules and people who leave (M27)

A schedule (a timed release, unpublish or build, see the user guide *Publishing*) runs **as the person who owns it** —
whoever created it, or last took it over — and the server checks at every run that this person may still do it
(a scheduled build: project `DEVELOPER` or above; a scheduled release or unpublish: a developer, or an editor while the
project's publish policy allows scheduling — and the build right after, if any; the account must not be disabled or
deleted — a *locked* account still counts). So removing someone from a project,
lowering their role, disabling or deleting their account affects their schedules:

- the next run fails with "Owner no longer permitted" (`SF-DOM-0163`) instead of acting with rights the person no
  longer has — the message names what is missing, e.g. "Owner no longer permitted (SCHEDULE_RELEASE): 'bob' is EDITOR
  without SCHEDULE_RELEASE in the project's publish policy." (the same happens when a project admin turns off an
  editor's permission, see *Letting editors publish*);
- a repeating schedule is **paused** ("Paused" on the Schedules page) and runs nothing until someone takes it over;
- any developer of the project — or an editor who may schedule releases, for a release or unpublish — can **Take
  over** a failed or paused schedule on the Schedules page: they become the
  owner, a paused schedule resumes at its next run time, and a failed one-off one runs right away (unless *Skip if
  more than … late* says it is too late).

Before removing a developer, filter the Schedules page by **Owner** to see what they own.

## Housekeeping jobs (M29)

**Administration → Jobs** lists the instance's *system jobs*: background work that keeps storage, the database and
memory from growing without limit and repairs what a crash leaves behind. Each row shows the schedule in words with its
time zone (the raw cron in the tooltip), the next run in your time zone (and the job's zone where it differs), the last
run (outcome, when, how long, how many items it removed, bytes freed) and a spinner while the job runs. The switch on
the row turns a job on or off at once. Open a job to change its schedule and settings, run it, and read its history.
The rules behind it are in `cms-specification.md` §26.6; the API is in [`docs/api.md`](api.md) §14.2.

A job runs at most once at a time, on any node. Times are cron expressions in the job's zone (default `UTC`,
`sf.housekeeping.zone`). A slot missed while the server was down runs once when it is back, not once per missed slot.

### The jobs

| Job | Default schedule | What it deletes or changes | What it never touches |
|---|---|---|---|
| **Generation run recovery** | at startup and every 5 minutes | Fails builds stuck in *Queued*/*Running* whose node restarted or whose heartbeat is older than `staleAfter` (5 min): diagnostic `SF-GEN-0504` | Builds still executing on a live node, whatever their heartbeat says |
| **Build output cleanup** | daily 03:10 | Staged output of failed, cancelled and vanished runs; leftover `.current-*.link` files and output of runs without a row older than `minAge` (1 h); output folders of deleted targets | `current`, the build it points at, published builds (rollback points), builds still running, S3 targets |
| **Blob sweep** | daily 03:30 | Stored media bytes no version of any revision, no variant and no run references, once they were neither created nor reused within `graceHours` (24); bytes in the store without a database row (failed uploads and imports) after the same grace | Anything a version references — current, old, deleted or closed; variants; anything written or reused within the grace period |
| **Audit purge** | daily 04:00 | Audit entries older than `retentionDays` (365, at least 30), instance and project entries | Newer entries; revisions (content history is not the audit log) |
| **Refresh-token cleanup** | hourly at :15 | Whole sign-in token families past their absolute expiry, or whose every token is revoked or expired for longer than `reuseWindow` (7 days) | Families with a usable token, including their revoked tokens — those detect a stolen token being reused |
| **Memory eviction** | every 10 minutes | In-memory sign-in rate-limit entries idle for 5 minutes, build idempotency keys older than `sf.generate.idempotency-ttl` (24 h) | Rate-limit entries still blocking |
| **Generation run retention** | daily 04:15 | Build records (with their stored plans) older than `keepDays` (90) **and** beyond the newest `keepPerProject` (50) of the project | Runs with a build on disk (rollback points), each target's current run, running builds, the builds those were carried from, runs of schedule executions younger than `keepDays` |
| **Media variant backfill** | daily 02:00 | Creates missing image variants of the current variant policy (a definition added later, an encode that failed), at most `maxPerRun` (500) per run; `includeHistorical` also covers old versions | Content: it writes no revision, creates no draft and changes no release status |
| **Search maintenance** | daily 05:00 | Per project: catches up missed indexing, rebuilds the index when its document count is off, merges away deleted documents above `mergeDeletesPct` (20 %) | Archived projects; a project whose rebuild is already running (reported *skipped*) |
| **Revision compaction** | Sundays 03:00 | Old versions of projects that opted in (project settings → General): history older than their *N* days collapses to the last version of each day | Projects that didn't opt in; released versions, versions of builds on disk, versions pinned by pending schedules, the last version of each day, anything newer than *N* days |

The defaults come from `sf.housekeeping.<job>.*` (see [`infra/README.md`](../infra/README.md#housekeeping-jobs-m29)).
They are copied into the database on the first start; after that, **what you save on the Jobs page wins**, also over
changed properties. **Reset to defaults** copies the properties again.

### Changing a job

The job page has a form for **Enabled**, the **cron** expression (described in words as you type, e.g. "Every day at
03:30 (UTC)"), the **time zone** and the job's own settings. Durations are written like `PT1H`, `30m`, `24h` or `7d`.
**Save** is enabled once something changed and the form is valid; the server checks again and shows its message under
the field. The next run time is recomputed when you save. If another admin saved the job meanwhile, you get a notice
and the form reloads with their values. Every save and reset is in the audit trail (`JOB_SETTINGS_SET`, with the values
before and after) — so lowering the audit retention leaves a trace that the purge can't remove until it ages out.

### Dry run first

Jobs that delete things — **Blob sweep**, **Audit purge**, **Build output cleanup**, **Generation run retention** and
**Revision compaction** — offer **Dry run**: it does all the work of finding what to delete and deletes nothing. Before
you change a destructive setting (a shorter grace period, a lower retention), save it, run a dry run and read the
report; nothing forces you to, but it costs nothing. A real run right after deletes exactly what the dry run reported
when nothing changed in between.

**Run now** and **Dry run** start the job immediately (both are audited, `JOB_RUN`); a manual run doesn't move the
next scheduled run. The page shows progress and then the **report**: items examined and affected, bytes freed, a table
of up to 50 sample items (e.g. blob hashes with type and size, audit entries, run ids, removed paths) and the job's own
counts (e.g. per audit action, per project). The **history** below lists every run with its trigger (*schedule*,
*manual*, *startup*), whether it was a dry run and who started it; open a row for its report. The newest 200 runs per
job are kept (`sf.housekeeping.history-per-job`).

### Outcomes and what to do when a job fails

| Outcome | Meaning | What to do |
|---|---|---|
| **Succeeded** | Done | — |
| **Partial** | Done, but some items failed: a project's search index was unavailable or timed out, a variant couldn't be encoded, one project failed to compact | Read the report; the job retries on its next run. A variant that keeps failing is usually a broken source file |
| **Skipped** | Nothing could be done now, e.g. a search index rebuild was already running | Nothing; the next run picks it up |
| **Failed** | The job stopped with an error; the message says why | Read the message, fix the cause (disk full, database unreachable, permissions on the output or media folder) and press **Run now**. A failed job keeps its schedule and runs again at the next slot |

A **greyed** job marked as no longer installed is a leftover row of a job that was removed in an upgrade; it never
runs and can't be changed. Monitoring: every job exposes `sf.job.duration`, `sf.job.items`, `sf.job.bytes.freed` and
`sf.job.last.success.age` on `/actuator/prometheus`. Alert when `sf.job.last.success.age{job}` exceeds twice the job's
interval (more than 2 days for a daily job, more than 10 minutes for run recovery) — see `cms-specification.md` §26.4.
The blob store health (`/actuator/health`) shows the last sweep's outcome.

### Interrupted builds

When the server stops during a build — a restart, a crash, a node that loses contact — the build can't finish. Before
M29 it stayed *Running* and blocked every later build of the project. Now **Generation run recovery** marks it
*Failed* with "Run interrupted (node restart or lost heartbeat)" (`SF-GEN-0504`): at startup for the node's own builds,
otherwise within `staleAfter` plus 5 minutes. After that the project builds normally again, and a scheduled build that
was waiting for it starts. The published site is untouched: an interrupted build never flips `current`, and its staged
files are removed by the next **Build output cleanup**. Just start the build again.

Give each server a stable name (`sf.node-id` / `SF_NODE_ID`) so a restarted node recognizes its own interrupted builds
at once; without one it still recognizes them by the dead process id on the same host. **Cancel** on a running build
really stops it: it never publishes after you cancelled.

### Backups and restore drills

Two jobs delete data for good, which matters for backups (`cms-specification.md` §26.5, the backup runbook in
`infra/docs/backup-recovery-runbook.md`):

- **Blob sweep** may delete media bytes that an **older database backup** still references (media removed from history
  by compaction, or orphans of that time). For a restore drill, either keep blob-store snapshots from at least *grace
  period + backup interval* before the database backup, or **disable Blob sweep** for the drill (the switch on the Jobs
  page; on a fresh instance `sf.housekeeping.blob-sweep.enabled=false` before the first start). Never let the sweep run
  against a restored database before you checked that the blob store is complete.
- **Revision compaction** removes old versions of opted-in projects; only a database backup from before the run brings
  them back.

## The audit trail

**Administration → Audit** lists every security-relevant event of the instance, newest first: sign-ins (and failed
ones), account changes, membership changes, archiving, channel and generation-target changes, publish policy changes
(`PUBLISH_POLICY_SET`), generation runs started, cancelled and promoted (`GENERATION_STARTED` — as the schedule's owner
for a scheduled build —, `GENERATION_CANCELLED`, `GENERATION_PROMOTED`), and schedules — created, changed, cancelled,
taken over, run now, and each execution (as its owner), housekeeping job changes and manual runs (`JOB_SETTINGS_SET`,
`JOB_RUN`) and revision compaction (`COMPACTION_POLICY_SET`, `REVISIONS_COMPACTED`). Releases are not audit entries: each is a
revision, listed in the project's revision history. Filter by action, user,
project (or *Instance only* for account events) and date range; the filters are part of the address, so a filtered
view can be bookmarked or shared with another admin. (A project admin can read their own project's entries through
the API, `GET /api/v1/projects/{key}/audit`.) Entries older than a year are deleted by the **Audit purge** job (see
[Housekeeping jobs](#housekeeping-jobs-m29)); purged action names disappear from the action filter.
