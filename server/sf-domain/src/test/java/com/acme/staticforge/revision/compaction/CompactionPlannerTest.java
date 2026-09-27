package com.acme.staticforge.revision.compaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.revision.compaction.CompactionPlanner.Absorption;
import com.acme.staticforge.revision.compaction.CompactionPlanner.Protection;
import com.acme.staticforge.revision.compaction.CompactionPlanner.ReferencePlan;
import com.acme.staticforge.revision.compaction.CompactionPlanner.ReferenceRow;
import com.acme.staticforge.revision.compaction.CompactionPlanner.VersionRow;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The pure planning of revision compaction (M29.4.2): survivors, absorptions and reference rewrites. */
class CompactionPlannerTest {

    private static final Instant DAY_1 = Instant.parse("2025-01-10T08:00:00Z");
    private static final Instant DAY_2 = Instant.parse("2025-01-11T08:00:00Z");
    private static final Instant CUTOFF = Instant.parse("2025-06-01T00:00:00Z");

    @Test
    @DisplayName("5 versions on one day, the 2nd released: 1 is absorbed into 2, 3 and 4 into 5")
    void releasedVersionSplitsTheDay() {
        List<VersionRow> versions = List.of(
                v(1, 10, 11, DAY_1), v(2, 11, 12, DAY_1), v(3, 12, 13, DAY_1), v(4, 13, 14, DAY_1), v(5, 14, 15, DAY_1),
                v(6, 15, null, DAY_2));

        List<Absorption> plan = CompactionPlanner.plan(versions, CUTOFF, protectIds(2));

        assertThat(plan).hasSize(2);
        assertThat(plan.get(0).survivor().id()).isEqualTo(2);
        assertThat(ids(plan.get(0).removed())).containsExactly(1L);
        assertThat(plan.get(0).newValidFrom()).isEqualTo(10);
        assertThat(plan.get(1).survivor().id()).isEqualTo(5);
        assertThat(ids(plan.get(1).removed())).containsExactly(3L, 4L);
        assertThat(plan.get(1).newValidFrom()).isEqualTo(12);
        assertThat(plan.get(1).survivorOriginalValidFrom()).isEqualTo(14);
    }

    @Test
    @DisplayName("a run whose next survivor is the open version is kept")
    void neverAbsorbsIntoTheOpenVersion() {
        List<VersionRow> versions = List.of(v(1, 10, 11, DAY_1), v(2, 11, 12, DAY_1), v(3, 12, null, DAY_1));

        assertThat(CompactionPlanner.plan(versions, CUTOFF, Protection.NONE)).isEmpty();

        // Once a later save closes version 3, 1 and 2 go into it.
        List<VersionRow> closed = List.of(
                v(1, 10, 11, DAY_1), v(2, 11, 12, DAY_1), v(3, 12, 13, DAY_1), v(4, 13, null, DAY_2));
        List<Absorption> plan = CompactionPlanner.plan(closed, CUTOFF, Protection.NONE);
        assertThat(plan).singleElement().satisfies(a -> {
            assertThat(a.survivor().id()).isEqualTo(3);
            assertThat(ids(a.removed())).containsExactly(1L, 2L);
        });
    }

    @Test
    @DisplayName("versions of revisions at or after the cutoff are outside the window: neither removed nor absorbing")
    void cutoffBoundsTheWindow() {
        Instant cutoff = DAY_1.plusSeconds(30);
        List<VersionRow> versions = List.of(
                v(1, 10, 11, DAY_1),
                v(2, 11, 12, DAY_1.plusSeconds(10)),
                v(3, 12, 13, DAY_1.plusSeconds(60)),
                v(4, 13, null, DAY_2));

        // 1 and 2 are in the window, but the last version of their day (3) is not: they wait for it and are kept.
        assertThat(CompactionPlanner.plan(versions, cutoff, Protection.NONE)).isEmpty();
    }

    @Test
    @DisplayName("versions valid at a protected revision survive, and so does the last version of each day")
    void protectedRevisionsAndDays() {
        List<VersionRow> versions = List.of(
                v(1, 10, 11, DAY_1), v(2, 11, 14, DAY_1), v(3, 14, 15, DAY_1),
                v(4, 15, 16, DAY_2), v(5, 16, 17, DAY_2), v(6, 17, null, DAY_2.plusSeconds(86_400)));

        List<Absorption> plan = CompactionPlanner.plan(versions, CUTOFF, new Protection(Set.of(), new TreeSet<>(Set.of(12L))));

        // Day 1: 2 is valid at r12 → survives, absorbs 1; 3 is the last of day 1. Day 2: 4 → 5 (last of day 2).
        assertThat(plan).hasSize(2);
        assertThat(plan.get(0).survivor().id()).isEqualTo(2);
        assertThat(ids(plan.get(0).removed())).containsExactly(1L);
        assertThat(plan.get(1).survivor().id()).isEqualTo(5);
        assertThat(ids(plan.get(1).removed())).containsExactly(4L);
    }

    @Test
    @DisplayName("a version without a dated revision is never in the window and splits the groups")
    void undatedVersionsSurvive() {
        List<VersionRow> versions = List.of(
                v(1, 10, 11, DAY_1), v(2, 11, 12, null), v(3, 12, 13, DAY_1), v(4, 13, null, DAY_2));

        assertThat(CompactionPlanner.plan(versions, CUTOFF, Protection.NONE)).isEmpty();
    }

    @Test
    @DisplayName("a survivor moved back earlier keeps its first original valid_from")
    void survivorKeepsTheFirstOriginal() {
        VersionRow survivor = new VersionRow(3, 1, 11, 14L, 13L, DAY_1);
        List<VersionRow> versions = List.of(v(1, 10, 11, DAY_1), survivor, v(4, 14, null, DAY_2));

        Absorption absorption = CompactionPlanner.plan(versions, CUTOFF, Protection.NONE).get(0);

        assertThat(absorption.newValidFrom()).isEqualTo(10);
        assertThat(absorption.survivorOriginalValidFrom()).isEqualTo(13);
    }

    @Test
    @DisplayName("references: edges at every revision of the absorbed interval become the survivor's")
    void referencesFollowTheSurvivor() {
        // Versions: [10,12) removed, [12,15) survivor. Rows: A [5,11) trimmed, B [10,11) inside → deleted,
        // C [11,null) valid at 12 → starts at 10, D [3,null) spans → untouched, E [12,14) valid at 12 → [10,14),
        // F [15,20) after → untouched, G [8,10) before → untouched.
        List<ReferenceRow> rows = List.of(
                r(1, 5, 11L), r(2, 10, 11L), r(3, 11, null), r(4, 3, null), r(5, 12, 14L), r(6, 15, 20L), r(7, 8, 10L));
        Absorption absorption = new Absorption(v(3, 12, 15, DAY_1), List.of(v(1, 10, 11, DAY_1), v(2, 11, 12, DAY_1)));

        ReferencePlan plan = CompactionPlanner.planReferences(rows, List.of(absorption));

        assertThat(plan.deleted()).containsExactly(2L);
        assertThat(plan.updated()).containsExactly(r(1, 5, 10L), r(3, 10, null), r(5, 10, 14L));
        Map<Long, ReferenceRow> after = apply(rows, plan);
        for (long rev = 10; rev < 12; rev++) {
            assertThat(validAt(after, rev)).as("rows at r%s", rev).isEqualTo(validAt(after, 12));
        }
        for (long rev : new long[] {3, 5, 8, 9, 15, 19, 25}) {
            assertThat(validAt(after, rev)).as("rows at r%s unchanged", rev).isEqualTo(validAt(index(rows), rev));
        }
    }

    @Test
    @DisplayName("references: several absorptions of one asset compose")
    void severalAbsorptions() {
        List<ReferenceRow> rows = List.of(r(1, 10, 11L), r(2, 11, 13L), r(3, 13, 20L), r(4, 20, null));
        List<Absorption> absorptions = List.of(
                new Absorption(v(2, 11, 13, DAY_1), List.of(v(1, 10, 11, DAY_1))),
                new Absorption(v(5, 16, 20, DAY_2), List.of(v(3, 13, 15, DAY_2), v(4, 15, 16, DAY_2))));

        Map<Long, ReferenceRow> after = apply(rows, CompactionPlanner.planReferences(rows, absorptions));

        assertThat(validAt(after, 10)).isEqualTo(validAt(index(rows), 11));
        for (long rev = 13; rev < 20; rev++) {
            assertThat(validAt(after, rev)).isEqualTo(validAt(index(rows), 16));
        }
        assertThat(validAt(after, 20)).isEqualTo(validAt(index(rows), 20));
    }

    private static VersionRow v(long id, long from, Integer to, Instant created) {
        return new VersionRow(id, 1, from, to == null ? null : to.longValue(), null, created);
    }

    private static ReferenceRow r(long id, long from, Long to) {
        return new ReferenceRow(id, from, to);
    }

    private static Protection protectIds(long... ids) {
        Set<Long> set = new java.util.HashSet<>();
        for (long id : ids) {
            set.add(id);
        }
        return new Protection(set, new TreeSet<>());
    }

    private static List<Long> ids(List<VersionRow> rows) {
        return rows.stream().map(VersionRow::id).toList();
    }

    private static Map<Long, ReferenceRow> index(List<ReferenceRow> rows) {
        return rows.stream().collect(Collectors.toMap(ReferenceRow::id, row -> row));
    }

    private static Map<Long, ReferenceRow> apply(List<ReferenceRow> rows, ReferencePlan plan) {
        Map<Long, ReferenceRow> out = new java.util.TreeMap<>(index(rows));
        plan.deleted().forEach(out::remove);
        plan.updated().forEach(row -> out.put(row.id(), row));
        return out;
    }

    private static Set<Long> validAt(Map<Long, ReferenceRow> rows, long revision) {
        List<Long> out = new ArrayList<>();
        rows.values().stream()
                .filter(row -> row.validFrom() <= revision && (row.validTo() == null || row.validTo() > revision))
                .forEach(row -> out.add(row.id()));
        return new TreeSet<>(out);
    }
}
