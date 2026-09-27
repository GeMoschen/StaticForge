package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import org.springframework.jdbc.core.JdbcTemplate;
import net.jqwik.api.constraints.IntRange;
import java.time.ZoneOffset;
import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.time.Duration;
import com.fasterxml.jackson.databind.JsonNode;
import com.acme.staticforge.revision.compaction.RevisionCompactor;
import com.acme.staticforge.revision.compaction.CompactionResult;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.reference.ReferenceEdge;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetRelease;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseState;
import com.acme.staticforge.release.ReleaseStates;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import net.jqwik.api.Tuple;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Property-based revision invariants (spec §25.5). Random sequences of mutations must
 * yield gapless revision ids and at most one valid version per asset per revision.
 *
 * <p>{@code M15.3.1} extends the generated action set with {@link BatchOp} — a batch of
 * 2-5 asset updates committed as a single compound revision via {@code
 * RevisionService#beginBatch}/{@code #allocateOrJoin} (spec §7.1, {@code M15.1}/{@code
 * M15.2}) — alongside the pre-existing {@link SingleOp} single-asset updates, so the five
 * invariants are re-verified against a world where a revision can touch N>1 assets, not
 * only exactly one.
 *
 * <p>{@code M16.3.3} makes the addressed assets pages whose generated payloads reference a
 * random subset of two media assets, and adds the reference invariant: for every revision
 * {@code R} and page, the {@code asset_reference} edges valid at {@code R} equal the edges
 * extracted from the version valid at {@code R} (none for a deleted version).
 */
class RevisionInvariantsTest {

    private static CtxHolder holder;

    /** Number of pre-created folders a property run can address; wide enough that a
     * batch of up to 5 distinct assets is always satisfiable. */
    private static final int ASSET_COUNT = 6;

    @Property(tries = 25)
    void randomMutationSequencesAreRevisionSafe(@ForAll("ops") List<Op> ops) {
        CtxHolder h = context();
        AppUser actor = h.fixtures.user("u-" + suffix());
        Project project = h.fixtures.project("p-" + suffix(), actor);

        List<UUID> media = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            media.add(h.assets.create(
                            new CreateAssetCommand(
                                    project.getId(), AssetType.MEDIA, "m" + i, null, h.mapper.createObjectNode(), null),
                            RevisionContext.of(project.getId(), actor.getId(), "create"))
                    .uuid());
        }

        List<UUID> uuids = new ArrayList<>();
        for (int i = 0; i < ASSET_COUNT; i++) {
            AssetVersionView created = h.assets.create(
                    new CreateAssetCommand(
                            project.getId(), AssetType.PAGE, "f" + i, null, h.mapper.createObjectNode(), null),
                    RevisionContext.of(project.getId(), actor.getId(), "create"));
            uuids.add(created.uuid());
        }

        for (Op op : ops) {
            if (op instanceof SingleOp single) {
                UUID uuid = uuids.get(single.index());
                long expected = h.assets.requireCurrent(project.getId(), uuid).validFromRevision();
                h.assets.update(
                        uuid,
                        new UpdateAssetCommand(single.name(), payloadFor(h, single.name(), media)),
                        expected,
                        RevisionContext.of(project.getId(), actor.getId(), "update"));
            } else if (op instanceof BatchOp batchOp) {
                applyBatch(h, project, actor, uuids, media, batchOp);
            }
        }

        List<Revision> revisions = h.revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId());
        Set<Long> ids = new HashSet<>();
        revisions.forEach(r -> ids.add(r.getRevisionId()));

        long n = ids.size();
        for (long r = 1; r <= n; r++) {
            assertThat(ids).as("revision %s present", r).contains(r);
        }

        for (UUID uuid : uuids) {
            Asset asset = h.assetRepository.findByProjectIdAndUuid(project.getId(), uuid).orElseThrow();
            List<AssetVersion> versions = h.versionRepository.findByAssetIdOrderByValidFromRevisionDesc(asset.getId());
            for (long r = 1; r <= n; r++) {
                final long rr = r;
                long count = versions.stream()
                        .filter(v -> v.getValidFromRevision() <= rr
                                && (v.getValidToRevision() == null || v.getValidToRevision() > rr))
                        .count();
                assertThat(count).as("at most one version valid at r=%s", r).isBetween(0L, 1L);
            }

            // Invariant 6 (references follow versions): edges valid at r == edges extracted from
            // the version valid at r.
            List<com.acme.staticforge.asset.AssetReference> rows = h.referenceRepository.findByFromAssetId(asset.getId());
            for (long r = 1; r <= n; r++) {
                final long rr = r;
                Set<ReferenceEdge> expected = versions.stream()
                        .filter(v -> v.getValidFromRevision() <= rr
                                && (v.getValidToRevision() == null || v.getValidToRevision() > rr))
                        .findFirst()
                        .filter(v -> !v.isDeleted())
                        .map(v -> h.materializer.extract(project.getId(), AssetType.PAGE, v.getPayload()))
                        .orElse(Set.of());
                Set<ReferenceEdge> actual = new HashSet<>();
                rows.stream()
                        .filter(e -> e.getValidFromRevision() <= rr
                                && (e.getValidToRevision() == null || e.getValidToRevision() > rr))
                        .forEach(e -> assertThat(actual.add(ReferenceEdge.of(e)))
                                .as("no duplicate edge valid at r=%s", rr)
                                .isTrue());
                assertThat(actual).as("edges valid at r=%s", r).isEqualTo(expected);
            }
        }
    }

    /**
     * A page payload referencing a name-derived subset of the two media assets: none, either, or
     * both (at two paths), so random op sequences add, move and remove edges.
     */
    private static ObjectNode payloadFor(CtxHolder h, String name, List<UUID> media) {
        ObjectNode payload = h.mapper.createObjectNode().put("name", name);
        ObjectNode content = payload.putObject("content");
        int bits = name.chars().sum() % 4;
        if ((bits & 1) != 0) {
            content.putObject("hero").put("type", "MEDIA_REF").put("uuid", media.get(0).toString());
        }
        if ((bits & 2) != 0) {
            content.putArray("gallery").addObject().put("type", "MEDIA_REF").put("uuid", media.get(name.length() % 2).toString());
        }
        return payload;
    }

    /**
     * Applies one generated batch action exactly the way a real orchestrating call site
     * does ({@code TemplateServiceImpl.migrateRenames}/{@code ensureFoldersAndMigrate},
     * {@code ProjectServiceImpl.create}): one {@code beginBatch}, then one {@code
     * allocateOrJoin} per touched asset inside the loop, closing and inserting a new
     * version row directly (mirroring what {@code AssetServiceImpl}'s private helpers do
     * for a single asset). Unlike those call sites' snapshot-then-write pattern, each
     * item here re-reads the asset's currently-open version immediately before writing —
     * so the batch action itself never manufactures a lost update against a concurrent
     * writer; that guarantee is instead proven for the mechanism itself by {@code
     * ConcurrentWritersTest#concurrentBatchesAndSingleWritersProduceNoLostUpdates}.
     */
    private void applyBatch(
            CtxHolder h, Project project, AppUser actor, List<UUID> uuids, List<UUID> media, BatchOp batchOp) {
        long beforeRevisionCount = h.revisionRepository
                .findByProjectIdOrderByRevisionIdDesc(project.getId())
                .size();

        // Pre-batch snapshot of every touched asset, taken before any write in the batch,
        // so invariant 4 (correct restore) can later prove restoring one of them reverts
        // exactly to this state.
        Map<UUID, AssetVersionView> preBatch = new HashMap<>();
        for (IndexedName item : batchOp.items()) {
            UUID uuid = uuids.get(item.index());
            preBatch.put(uuid, h.assets.requireCurrent(project.getId(), uuid));
        }

        Revision batch = h.revisionService.beginBatch(project.getId(), ChangeType.UPDATE, "batch", actor.getId());
        RevisionContext batchCtx = RevisionContext.joining(batch, actor.getId(), "batch");

        for (IndexedName item : batchOp.items()) {
            UUID uuid = uuids.get(item.index());
            Asset asset = h.assetRepository.findByProjectIdAndUuid(project.getId(), uuid).orElseThrow();
            AssetVersion current = h.versionRepository
                    .findByAssetIdAndValidToRevisionIsNull(asset.getId())
                    .orElseThrow();

            Revision joined = h.revisionService.allocateOrJoin(batchCtx, ChangeType.UPDATE);
            // Invariant 1 (gapless): every item in the batch must join the SAME revision —
            // a batch of N items must never allocate N counter values.
            assertThat(joined.getRevisionId()).as("batch item joins the shared batch revision")
                    .isEqualTo(batch.getRevisionId());

            current.setValidToRevision(joined.getRevisionId());
            h.versionRepository.save(current);

            ObjectNode payload = payloadFor(h, item.name(), media);
            AssetVersion next = new AssetVersion(
                    asset.getId(), joined.getRevisionId(), item.name(), payload, actor.getId(), Instant.now());
            next.setFolderId(current.getFolderId());
            next.setFolderPath(current.getFolderPath());
            next.setTemplateAssetId(current.getTemplateAssetId());
            next.setDeleted(current.isDeleted());
            // Like every real version writer, sync the reference rows in the same revision (M16.3.1).
            h.materializer.materialize(asset, h.versionRepository.save(next));

            h.revisionService.appendSummary(
                    project.getId(),
                    joined.getRevisionId(),
                    AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), "UPDATE", List.of("payload")));
        }

        long afterRevisionCount = h.revisionRepository
                .findByProjectIdOrderByRevisionIdDesc(project.getId())
                .size();
        // Invariant 1 (gapless): a batch of N asset changes consumes exactly one counter
        // value, not N — the revision count grows by exactly 1 regardless of batch size.
        assertThat(afterRevisionCount).as("batch of %s items allocates exactly one revision", batchOp.items().size())
                .isEqualTo(beforeRevisionCount + 1);

        // Invariant 3 (reproducible reads): reading every batch-touched asset AT the
        // batch's own revision id must reflect every item's change together — a batch
        // action is the only thing that can prove "atomically", since a single-asset
        // action never has more than one asset to check for togetherness.
        for (IndexedName item : batchOp.items()) {
            UUID uuid = uuids.get(item.index());
            AssetVersionView atBatch = h.assets.findAt(project.getId(), uuid, batch.getRevisionId()).orElseThrow();
            assertThat(atBatch.displayName()).as("asset %s reflects its batch change atomically", uuid)
                    .isEqualTo(item.name());
        }

        // Invariant 4 (correct restore): restoring one batch-touched asset back to its
        // pre-batch revision must work exactly as a single-asset restore does, byte-for-byte.
        IndexedName first = batchOp.items().get(0);
        UUID restoreTarget = uuids.get(first.index());
        AssetVersionView pre = preBatch.get(restoreTarget);
        AssetVersionView restored = h.assets.restore(
                restoreTarget, pre.validFromRevision(), RevisionContext.of(project.getId(), actor.getId(), "restore"));
        assertThat(restored.displayName()).as("restoring a batch-touched asset reverts to its pre-batch state")
                .isEqualTo(pre.displayName());
        assertThat(restored.payload()).isEqualTo(pre.payload());
    }

    /**
     * M27.1.2: release pointers follow the same interval discipline as versions and references. Random sequences of
     * edits, releases, unpublishes and discards must leave at most one pointer valid per asset at every revision, and
     * the release state read at each revision ({@code ReleaseStates.at}) must equal what a model of the sequence
     * says was released then — which proves time travel of release state.
     */
    @Property(tries = 20)
    void randomReleaseSequencesKeepPointerInvariants(@ForAll("releaseOps") List<ReleaseOp> ops) {
        CtxHolder h = context();
        ReleaseService releases = h.ctx.getBean(ReleaseService.class);
        ReleaseStates states = h.ctx.getBean(ReleaseStates.class);
        AssetReleaseRepository pointers = h.ctx.getBean(AssetReleaseRepository.class);
        AppUser actor = h.fixtures.user("u-" + suffix());
        Project project = h.fixtures.project("p-" + suffix(), actor);
        RevisionContext ctx = RevisionContext.of(project.getId(), actor.getId(), "release invariants");

        List<UUID> uuids = new ArrayList<>();
        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            AssetVersionView page = h.assets.create(
                    new CreateAssetCommand(project.getId(), AssetType.PAGE, "r" + i, null, h.mapper.createObjectNode(), null),
                    ctx);
            uuids.add(page.uuid());
            ids.add(h.assetRepository.findByProjectIdAndUuid(project.getId(), page.uuid()).orElseThrow().getId());
        }

        // Model: the released version id of each page (null = not released), recorded after every revision.
        Map<Integer, Long> released = new HashMap<>();
        Map<Long, Map<Integer, Long>> modelAt = new HashMap<>();
        for (ReleaseOp op : ops) {
            UUID uuid = uuids.get(op.index());
            Long draft = h.versionRepository.findByAssetIdAndValidToRevisionIsNull(ids.get(op.index())).orElseThrow().getId();
            switch (op.kind()) {
                case EDIT -> h.assets.update(
                        uuid,
                        new UpdateAssetCommand("n" + op.name(), h.mapper.createObjectNode().put("name", op.name())),
                        h.assets.requireCurrent(project.getId(), uuid).validFromRevision(),
                        ctx);
                case RELEASE -> {
                    if (releases.release(List.of(ReleaseItem.of(uuid)), ctx).revision() != null) {
                        released.put(op.index(), draft);
                    }
                }
                case UNPUBLISH -> releases.unpublish(List.of(ReleaseItem.of(uuid)), ctx);
                case DISCARD -> {
                    if (released.get(op.index()) != null) {
                        releases.discard(List.of(ReleaseItem.of(uuid)), ctx);
                    }
                }
            }
            if (op.kind() == ReleaseKind.UNPUBLISH) {
                released.remove(op.index());
            }
            long head = h.revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId()).get(0).getRevisionId();
            modelAt.put(head, new HashMap<>(released));
        }

        long head = h.revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId()).get(0).getRevisionId();
        for (int i = 0; i < ids.size(); i++) {
            List<AssetRelease> rows = pointers.findByAssetIdAndValidToRevisionIsNull(ids.get(i));
            assertThat(rows).as("at most one open pointer for page %s", i).hasSizeLessThanOrEqualTo(1);
        }
        List<AssetRelease> history = pointers.findByProjectIdOrderByAssetIdAscLocaleKeyAscValidFromRevisionAsc(project.getId());
        for (long r = 1; r <= head; r++) {
            final long rr = r;
            for (Long id : ids) {
                long valid = history.stream()
                        .filter(p -> p.getAssetId().equals(id))
                        .filter(p -> p.getValidFromRevision() <= rr && (p.getValidToRevision() == null || p.getValidToRevision() > rr))
                        .count();
                assertThat(valid).as("at most one pointer valid at r=%s", r).isLessThanOrEqualTo(1);
            }
        }
        for (Map.Entry<Long, Map<Integer, Long>> expected : modelAt.entrySet()) {
            ReleaseState state = states.at(project.getId(), expected.getKey());
            for (int i = 0; i < ids.size(); i++) {
                assertThat(state.releasedVersionId(ids.get(i), ReleaseLocales.ALL))
                        .as("page %s released at r=%s", i, expected.getKey())
                        .isEqualTo(expected.getValue().get(i));
            }
        }
    }

    /**
     * M29.4.2: revision compaction keeps the invariants. Random histories of three pages over several (back-dated) days,
     * with random releases, are compacted with a random cutoff; then, for every page and every revision:
     *
     * <ul>
     *   <li>exactly one version is valid (from the page's first revision on) and intervals stay contiguous;
     *   <li>where the version valid before survived, the read is byte-identical to before (outside compacted groups,
     *       and at every protected version);
     *   <li>where it was removed, the read is the group's survivor: the next surviving version of the removed one's UTC
     *       day, and the removed version was neither released, open, the last of its day nor newer than the cutoff;
     *   <li>the reference rows valid at R equal the edges extracted from the version valid at R.
     * </ul>
     *
     * A dry run first must report exactly what the real run then does.
     */
    @Property(tries = 20)
    void compactionKeepsRevisionInvariants(
            @ForAll("historyOps") List<HistoryOp> ops, @ForAll @IntRange(min = 0, max = 6) int cutoffDay) {
        CtxHolder h = context();
        ReleaseService releases = h.ctx.getBean(ReleaseService.class);
        RevisionCompactor compactor = h.ctx.getBean(RevisionCompactor.class);
        CompactionFixtures history = h.ctx.getBean(CompactionFixtures.class);
        JdbcTemplate jdbc = h.ctx.getBean(JdbcTemplate.class);
        AppUser actor = h.fixtures.user("u-" + suffix());
        Project project = h.fixtures.project("p-" + suffix(), actor);
        RevisionContext ctx = RevisionContext.of(project.getId(), actor.getId(), "compaction invariants");

        List<UUID> media = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            media.add(h.assets.create(new CreateAssetCommand(
                    project.getId(), AssetType.MEDIA, "m" + i, null, h.mapper.createObjectNode(), null), ctx).uuid());
        }
        List<UUID> uuids = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            uuids.add(h.assets.create(new CreateAssetCommand(
                    project.getId(), AssetType.PAGE, "c" + i, null, payloadFor(h, "c" + i, media), null), ctx).uuid());
        }

        // Run the history, remembering the day of every revision.
        Map<Long, Integer> dayOf = new HashMap<>();
        int day = 0;
        long seen = 0;
        for (HistoryOp op : ops) {
            UUID uuid = uuids.get(op.index());
            switch (op.kind()) {
                case EDIT -> h.assets.update(
                        uuid,
                        new UpdateAssetCommand(op.name(), payloadFor(h, op.name(), media)),
                        h.assets.requireCurrent(project.getId(), uuid).validFromRevision(),
                        ctx);
                case RELEASE -> releases.release(List.of(ReleaseItem.of(uuid)), ctx);
                case NEXT_DAY -> day++;
            }
            long now = history.head(project.getId());
            for (long r = seen + 1; r <= now; r++) {
                dayOf.put(r, day);
            }
            seen = now;
        }
        long head = history.head(project.getId());
        for (long r = 1; r <= head; r++) {
            Instant at = CompactionFixtures.DAY_1.plus(Duration.ofDays(dayOf.getOrDefault(r, 0))).plusSeconds(60 * r);
            history.backdate(project.getId(), r, r, at);
        }
        Instant cutoff = CompactionFixtures.DAY_1.plus(Duration.ofDays(cutoffDay)).plusSeconds(3600);

        Map<Long, Map<Long, AssetVersion>> before = new HashMap<>();
        Map<Long, List<AssetVersion>> versionsBefore = new HashMap<>();
        Map<Long, Map<Long, JsonNode>> readsBefore = new HashMap<>();
        List<Long> assetIds = new ArrayList<>();
        for (UUID uuid : uuids) {
            long assetId = history.assetId(project.getId(), uuid);
            assetIds.add(assetId);
            before.put(assetId, history.versionAt(assetId, head));
            versionsBefore.put(assetId, history.versions(assetId));
            readsBefore.put(assetId, history.readsAt(assetId, head));
        }
        Set<Long> released = new HashSet<>(jdbc.queryForList(
                "SELECT released_version_id FROM asset_release WHERE project_id = ?", Long.class, project.getId()));
        Map<Long, Instant> createdAt = new HashMap<>();
        jdbc.query("SELECT revision_id, created_at FROM revision WHERE project_id = ?",
                rs -> {
                    createdAt.put(rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant());
                },
                project.getId());

        CompactionResult dry = compactor.compact(project.getId(), cutoff, true, null);
        for (long assetId : assetIds) {
            assertThat(history.readsAt(assetId, head)).as("a dry run changes nothing").isEqualTo(readsBefore.get(assetId));
        }
        CompactionResult real = compactor.compact(project.getId(), cutoff, false, null);
        assertThat(real).usingRecursiveComparison().ignoringFields("sample").isEqualTo(dry);
        assertThat(h.revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId()))
                .as("revisions stay")
                .hasSize((int) head);

        for (long assetId : assetIds) {
            history.assertGapless(assetId, head);
            List<AssetVersion> old = versionsBefore.get(assetId);
            Set<Long> survivors = new HashSet<>();
            history.versions(assetId).forEach(v -> survivors.add(v.getId()));
            Map<Long, AssetVersion> now = history.versionAt(assetId, head);
            Map<Long, JsonNode> readsNow = history.readsAt(assetId, head);
            for (AssetVersion v : old) {
                boolean lastOfDay = old.stream().noneMatch(o -> o.getValidFromRevision() > v.getValidFromRevision()
                        && dayOf(createdAt, o).equals(dayOf(createdAt, v)));
                boolean inWindow = v.getValidToRevision() != null
                        && createdAt.get(v.getValidFromRevision()).isBefore(cutoff);
                if (released.contains(v.getId()) || lastOfDay || !inWindow) {
                    assertThat(survivors)
                            .as("protected version %s (released %s, last of day %s, in window %s) survives",
                                    v.getId(), released.contains(v.getId()), lastOfDay, inWindow)
                            .contains(v.getId());
                }
            }
            for (Map.Entry<Long, AssetVersion> entry : before.get(assetId).entrySet()) {
                long r = entry.getKey();
                AssetVersion was = entry.getValue();
                if (survivors.contains(was.getId())) {
                    assertThat(now.get(r).getId()).as("r%s: the surviving version is still the one read", r)
                            .isEqualTo(was.getId());
                    assertThat(readsNow.get(r)).as("r%s: byte-identical read", r)
                            .isEqualTo(readsBefore.get(assetId).get(r));
                } else {
                    AssetVersion survivor = old.stream()
                            .filter(o -> o.getValidFromRevision() > was.getValidFromRevision()
                                    && survivors.contains(o.getId()))
                            .findFirst()
                            .orElseThrow();
                    assertThat(now.get(r).getId()).as("r%s: the group's survivor is read", r).isEqualTo(survivor.getId());
                    assertThat(dayOf(createdAt, survivor)).as("r%s: absorbed within its day", r)
                            .isEqualTo(dayOf(createdAt, was));
                    assertThat(now.get(r).isCompactedAt(r)).as("r%s: flagged compacted", r).isTrue();
                }
            }
            Map<Long, Set<ReferenceEdge>> edges = history.edgesAt(assetId, head);
            now.forEach((r, v) -> assertThat(edges.get(r))
                    .as("edges at r%s", r)
                    .isEqualTo(v.isDeleted()
                            ? Set.of()
                            : h.materializer.extract(project.getId(), AssetType.PAGE, v.getPayload())));
        }
    }

    private static LocalDate dayOf(Map<Long, Instant> createdAt, AssetVersion version) {
        return LocalDate.ofInstant(createdAt.get(version.getValidFromRevision()), ZoneOffset.UTC);
    }

    @Provide
    Arbitrary<List<HistoryOp>> historyOps() {
        Arbitrary<HistoryKind> kind = Arbitraries.frequencyOf(
                Tuple.of(6, Arbitraries.just(HistoryKind.EDIT)),
                Tuple.of(2, Arbitraries.just(HistoryKind.RELEASE)),
                Tuple.of(2, Arbitraries.just(HistoryKind.NEXT_DAY)));
        Arbitrary<HistoryOp> op = Combinators.combine(
                        kind, Arbitraries.integers().between(0, 2), Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(8))
                .as(HistoryOp::new);
        return op.list().ofMinSize(3).ofMaxSize(30);
    }

    private enum HistoryKind { EDIT, RELEASE, NEXT_DAY }

    private record HistoryOp(HistoryKind kind, int index, String name) {}

    @Provide
    Arbitrary<List<ReleaseOp>> releaseOps() {
        Arbitrary<ReleaseOp> op = Combinators.combine(
                        Arbitraries.of(ReleaseKind.class),
                        Arbitraries.integers().between(0, 2),
                        Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(6))
                .as(ReleaseOp::new);
        return op.list().ofMinSize(1).ofMaxSize(12);
    }

    private enum ReleaseKind { EDIT, RELEASE, UNPUBLISH, DISCARD }

    private record ReleaseOp(ReleaseKind kind, int index, String name) {}

    @Provide
    Arbitrary<List<Op>> ops() {
        Arbitrary<Op> singleOp = Combinators.combine(
                        Arbitraries.integers().between(0, ASSET_COUNT - 1),
                        Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(12))
                .as((index, name) -> (Op) new SingleOp(index, name));

        Arbitrary<List<Integer>> batchIndices = Arbitraries.integers()
                .between(0, ASSET_COUNT - 1)
                .list()
                .ofMinSize(2)
                .ofMaxSize(5)
                .uniqueElements();
        Arbitrary<Op> batchOp = batchIndices.flatMap(indices -> Arbitraries.strings()
                .alpha()
                .ofMinLength(1)
                .ofMaxLength(12)
                .list()
                .ofSize(indices.size())
                .map(names -> {
                    List<IndexedName> items = new ArrayList<>();
                    for (int i = 0; i < indices.size(); i++) {
                        items.add(new IndexedName(indices.get(i), names.get(i)));
                    }
                    return (Op) new BatchOp(items);
                }));

        // Biased toward single-asset ops (the still-common case) while guaranteeing the
        // batch action shows up often enough, across 25 property tries, to exercise every
        // invariant assertion above at least once.
        Arbitrary<Op> op = Arbitraries.frequencyOf(Tuple.of(7, singleOp), Tuple.of(3, batchOp));
        return op.list().ofMinSize(1).ofMaxSize(10);
    }

    private sealed interface Op permits SingleOp, BatchOp {}

    private record SingleOp(int index, String name) implements Op {}

    private record BatchOp(List<IndexedName> items) implements Op {}

    private record IndexedName(int index, String name) {}

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static synchronized CtxHolder context() {
        if (holder == null) {
            ConfigurableApplicationContext ctx = new SpringApplication(StaticForgeApplication.class)
                    .run("--spring.profiles.active=test", "--server.port=0");
            holder = new CtxHolder(
                    ctx,
                    ctx.getBean(AssetService.class),
                    ctx.getBean(AssetRepository.class),
                    ctx.getBean(AssetVersionRepository.class),
                    ctx.getBean(RevisionRepository.class),
                    ctx.getBean(RevisionService.class),
                    ctx.getBean(AssetReferenceRepository.class),
                    ctx.getBean(ReferenceMaterializer.class),
                    new Fixtures(
                            ctx.getBean(UserService.class),
                            ctx.getBean(ProjectService.class),
                            ctx.getBean(AssetService.class)),
                    new ObjectMapper());
        }
        return holder;
    }

    private static final class CtxHolder {
        final ConfigurableApplicationContext ctx;
        final AssetService assets;
        final AssetRepository assetRepository;
        final AssetVersionRepository versionRepository;
        final RevisionRepository revisionRepository;
        final RevisionService revisionService;
        final AssetReferenceRepository referenceRepository;
        final ReferenceMaterializer materializer;
        final Fixtures fixtures;
        final ObjectMapper mapper;

        CtxHolder(
                ConfigurableApplicationContext ctx,
                AssetService assets,
                AssetRepository assetRepository,
                AssetVersionRepository versionRepository,
                RevisionRepository revisionRepository,
                RevisionService revisionService,
                AssetReferenceRepository referenceRepository,
                ReferenceMaterializer materializer,
                Fixtures fixtures,
                ObjectMapper mapper) {
            this.ctx = ctx;
            this.assets = assets;
            this.assetRepository = assetRepository;
            this.versionRepository = versionRepository;
            this.revisionRepository = revisionRepository;
            this.revisionService = revisionService;
            this.referenceRepository = referenceRepository;
            this.materializer = materializer;
            this.fixtures = fixtures;
            this.mapper = mapper;
        }
    }
}
