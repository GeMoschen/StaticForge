# `datetime`

A date-and-time picker — same stored shape and caveats as [`date`](date.md), plus a time
component. See [README.md](README.md) for attributes common to every editor type.

**Stored value:** ISO-8601 `string`, date and time (e.g. `"2026-08-26T14:30:00Z"`).

## Type-specific attributes

None currently take effect on the backend: `format "…"` is accepted syntactically but discarded,
same as on `date` — see [date.md](date.md) for the detail. Use the `date("pattern")` OCTL filter
at render time for display formatting.

## Example

```
editor datetime eventStart { label "Event start" }
```

## Rendering

```
$CMS_VALUE(eventStart | date("MMM d, yyyy 'at' h:mm a"))$
```
