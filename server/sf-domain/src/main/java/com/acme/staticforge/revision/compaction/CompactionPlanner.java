package com.acme.staticforge.revision.compaction;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.NavigableSet;
import java.util.Set;
import java.util.TreeSet;

/**
 * The pure part of revision compaction (M29.4.2, epic decision 13): which versions of one asset go and which survivor
 * absorbs them, and how the asset's reference rows change so that the edges at every revision still equal those of
 * the version valid there. No I/O; {@link RevisionCompactor} loads the rows, calls this and writes the result.
 *
 * <h2>Versions</h2>
 *
 * A version is <em>in the window</em> when it is closed and the {@code created_at} of its {@code valid_from_revision}
 * is before the cutoff. Its <em>day</em> is the UTC date of that {@code created_at}. The versions of an asset, in
 * revision order, fall into day groups (maximal runs of consecutive versions of the same day). In each group the
 * <em>survivors</em> are:
 *
 * <ul>
 *   <li>protected versions (released, pinned, or valid at a protected revision — a retained build's);
 *   <li>the last version of the group (the last of the day);
 *   <li>versions outside the window (the open version, versions newer than the cutoff, undated ones).
 * </ul>
 *
 * Every other version is removed and its interval absorbed by the next survivor of its group, whose
 * {@code valid_from_revision} moves back to the first removed version's. A removed run whose next survivor is itself
 * outside the window (the open version above all) is kept: absorbing into the open version would race with the next
 * save, and moving a version outside the window is not allowed. It becomes removable once a later save closes that
 * version. Intervals stay contiguous and gapless, and a protected version keeps being the version valid at every
 * revision it was valid at before.
 *
 * <h2>References</h2>
 *
 * For an absorption of {@code [a, b)} (a = first removed {@code valid_from}, b = the survivor's current
 * {@code valid_from}), the rows of the asset change like this, so that the rows valid at any {@code R} in
 * {@code [a, b)} are exactly the rows valid at {@code b} (the survivor's edges):
 *
 * <ul>
 *   <li>a row inside the interval ({@code from >= a}, closed at or before {@code b}) is deleted;
 *   <li>a row valid at {@code b} that starts at or after {@code a} starts at {@code a} instead;
 *   <li>a row that started before {@code a} and ended inside {@code (a, b]} ends at {@code a};
 *   <li>everything else is unchanged — in particular every row at a revision outside {@code [a, b)}.
 * </ul>
 */
public final class CompactionPlanner {

    private CompactionPlanner() {}

    /**
     * One version of an asset as compaction sees it.
     *
     * @param validTo exclusive end; {@code null} for the open version
     * @param originalValidFrom {@code valid_from_revision} before an earlier compaction moved it, or {@code null}
     * @param createdAt {@code created_at} of the {@code valid_from_revision}; {@code null} when the revision row is
     *     missing (such a version is never in the window)
     */
    public record VersionRow(
            long id, long assetId, long validFrom, Long validTo, Long originalValidFrom, Instant createdAt) {

        boolean validAt(long revision) {
            return validFrom <= revision && (validTo == null || validTo > revision);
        }

        /** The revision this version's own change was made in. */
        long changeRevision() {
            return originalValidFrom == null ? validFrom : originalValidFrom;
        }
    }

    /**
     * {@code removed} (consecutive, in revision order) are deleted and {@code survivor}, the version right after them,
     * becomes valid from {@link #newValidFrom()}.
     */
    public record Absorption(VersionRow survivor, List<VersionRow> removed) {

        public Absorption {
            removed = List.copyOf(removed);
        }

        /** The survivor's new {@code valid_from_revision}: the first removed version's. */
        public long newValidFrom() {
            return removed.get(0).validFrom();
        }

        /** The survivor's {@code original_valid_from} after the absorption: its first value is kept. */
        public long survivorOriginalValidFrom() {
            return survivor.originalValidFrom() == null ? survivor.validFrom() : survivor.originalValidFrom();
        }
    }

    /**
     * What protects a version from removal.
     *
     * @param versionIds released and pinned version ids
     * @param revisions revisions whose valid versions are protected (retained builds, running builds)
     */
    public record Protection(Set<Long> versionIds, NavigableSet<Long> revisions) {

        public static final Protection NONE = new Protection(Set.of(), new TreeSet<>());

        public Protection {
            versionIds = Set.copyOf(versionIds);
            revisions = new TreeSet<>(revisions);
        }

        boolean protects(VersionRow version) {
            if (versionIds.contains(version.id())) {
                return true;
            }
            Long first = revisions.ceiling(version.validFrom());
            return first != null && (version.validTo() == null || first < version.validTo());
        }
    }

    /** The absorptions of one asset's versions ({@code versions} in any order), in revision order. */
    public static List<Absorption> plan(Collection<VersionRow> versions, Instant cutoff, Protection protection) {
        List<VersionRow> sorted = versions.stream().sorted(Comparator.comparingLong(VersionRow::validFrom)).toList();
        List<Absorption> out = new ArrayList<>();
        int start = 0;
        while (start < sorted.size()) {
            int end = start + 1;
            LocalDate day = day(sorted.get(start));
            while (end < sorted.size() && day != null && day.equals(day(sorted.get(end)))) {
                end++;
            }
            planGroup(sorted.subList(start, end), cutoff, protection, out);
            start = end;
        }
        return out;
    }

    /** Whether {@code version} is in the window of {@code cutoff}: closed and of a revision before it. */
    public static boolean inWindow(VersionRow version, Instant cutoff) {
        return version.validTo() != null && version.createdAt() != null && version.createdAt().isBefore(cutoff);
    }

    private static void planGroup(List<VersionRow> group, Instant cutoff, Protection protection, List<Absorption> out) {
        List<VersionRow> pending = new ArrayList<>();
        for (int i = 0; i < group.size(); i++) {
            VersionRow version = group.get(i);
            boolean survivor = i == group.size() - 1 || !inWindow(version, cutoff) || protection.protects(version);
            if (!survivor) {
                pending.add(version);
                continue;
            }
            if (!pending.isEmpty() && inWindow(version, cutoff)) {
                out.add(new Absorption(version, pending));
            }
            pending = new ArrayList<>();
        }
    }

    private static LocalDate day(VersionRow version) {
        return version.createdAt() == null ? null : LocalDate.ofInstant(version.createdAt(), ZoneOffset.UTC);
    }

    // ------------------------------------------------------------------
    // References
    // ------------------------------------------------------------------

    /** One {@code asset_reference} row of the asset; only its interval matters here. */
    public record ReferenceRow(long id, long validFrom, Long validTo) {

        boolean validAt(long revision) {
            return validFrom <= revision && (validTo == null || validTo > revision);
        }
    }

    /**
     * How the reference rows change.
     *
     * @param deleted ids of rows to delete
     * @param updated rows whose interval changes, with the new bounds
     */
    public record ReferencePlan(List<Long> deleted, List<ReferenceRow> updated) {

        public int size() {
            return deleted.size() + updated.size();
        }
    }

    /** The reference changes that go with {@code absorptions} (of the same asset, in revision order). */
    public static ReferencePlan planReferences(Collection<ReferenceRow> rows, List<Absorption> absorptions) {
        List<ReferenceRow> current = new ArrayList<>(rows);
        Set<Long> deleted = new TreeSet<>();
        for (Absorption absorption : absorptions) {
            long a = absorption.newValidFrom();
            long b = absorption.survivor().validFrom();
            List<ReferenceRow> next = new ArrayList<>(current.size());
            for (ReferenceRow row : current) {
                if (row.validAt(b)) {
                    next.add(row.validFrom() >= a ? new ReferenceRow(row.id(), a, row.validTo()) : row);
                } else if (row.validTo() != null && row.validFrom() >= a && row.validTo() <= b) {
                    deleted.add(row.id());
                } else if (row.validFrom() < a && row.validTo() != null && row.validTo() > a && row.validTo() <= b) {
                    next.add(new ReferenceRow(row.id(), row.validFrom(), a));
                } else {
                    next.add(row);
                }
            }
            current = next;
        }
        List<ReferenceRow> updated = new ArrayList<>();
        for (ReferenceRow original : rows) {
            if (deleted.contains(original.id())) {
                continue;
            }
            current.stream()
                    .filter(row -> row.id() == original.id() && !row.equals(original))
                    .findFirst()
                    .ifPresent(updated::add);
        }
        updated.sort(Comparator.comparingLong(ReferenceRow::id));
        return new ReferencePlan(List.copyOf(deleted), List.copyOf(updated));
    }
}
