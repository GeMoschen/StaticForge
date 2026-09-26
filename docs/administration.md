# StaticForge — Administration guide

For instance administrators: accounts, sign-in problems and archiving projects — and, for project admins, what
editors may publish. Everything here is under
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

## The audit trail

**Administration → Audit** lists every security-relevant event of the instance, newest first: sign-ins (and failed
ones), account changes, membership changes, archiving, channel and generation-target changes, publish policy changes
(`PUBLISH_POLICY_SET`), generation runs started, cancelled and promoted (`GENERATION_STARTED` — as the schedule's owner
for a scheduled build —, `GENERATION_CANCELLED`, `GENERATION_PROMOTED`), and schedules — created, changed, cancelled,
taken over, run now, and each execution (as its owner). Releases are not audit entries: each is a
revision, listed in the project's revision history. Filter by action, user,
project (or *Instance only* for account events) and date range; the filters are part of the address, so a filtered
view can be bookmarked or shared with another admin. (A project admin can read their own project's entries through
the API, `GET /api/v1/projects/{key}/audit`.) There is no automatic clean-up of old entries yet.
