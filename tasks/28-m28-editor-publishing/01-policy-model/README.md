# Feature: Publish policy model

**Spec:** Extends §8.1 (project), §8.3 (role table), §8.4 (authorization), §20.2 (REST).

## Goal

Store the per-project editor policy, evaluate "may this user do X" in one rule usable from a request (token role) and
from the scheduler (membership row), and expose the policy and the caller's effective permissions to clients.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-publish-policy-model-and-api.md](001-publish-policy-model-and-api.md) | `M27` |

## Feature exit criteria

- [x] `publish_policy` exists for every project (empty after migration); `PUT` validates implications and records a
      revision + audit.
- [x] `can(projectKey, permission)` and `PublishPermissionEvaluator.permitted(...)` agree for every role × policy
      combination (one shared rule, tested).
- [x] `ProjectDetail` carries `publishPolicy` and the caller's `permissions`; a policy change is visible on the next
      request without re-login.

## Dependencies

`M27` (release/schedule endpoints exist to be guarded later), `M26` (`ProjectAuthorizationService`, audit, archived
guard).
