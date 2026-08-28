package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
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
 */
class RevisionInvariantsTest {

    private static CtxHolder holder;

    /** Number of pre-created folders a property run can address; wide enough that a
     * batch of up to 5 distinct assets is always satisfiable. */
    private static final int ASSET_COUNT = 6;

    @Property(tries = 25)
    void randomMutationSequencesAreRevisionSafe(@ForAll("ops") List<Op> ops) {
        CtxHolder h = context();
        ObjectNode payload = h.mapper.createObjectNode().put("seed", "x");

        AppUser actor = h.fixtures.user("u-" + suffix());
        Project project = h.fixtures.project("p-" + suffix(), actor);

        List<UUID> uuids = new ArrayList<>();
        for (int i = 0; i < ASSET_COUNT; i++) {
            AssetVersionView created = h.assets.create(
                    new CreateAssetCommand(
                            project.getId(), AssetType.FOLDER, "f" + i, null, h.mapper.createObjectNode(), null),
                    RevisionContext.of(project.getId(), actor.getId(), "create"));
            uuids.add(created.uuid());
        }

        for (Op op : ops) {
            if (op instanceof SingleOp single) {
                UUID uuid = uuids.get(single.index());
                long expected = h.assets.requireCurrent(project.getId(), uuid).validFromRevision();
                h.assets.update(
                        uuid,
                        new UpdateAssetCommand(single.name(), payload.deepCopy()),
                        expected,
                        RevisionContext.of(project.getId(), actor.getId(), "update"));
            } else if (op instanceof BatchOp batchOp) {
                applyBatch(h, project, actor, uuids, batchOp);
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
        }
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
    private void applyBatch(CtxHolder h, Project project, AppUser actor, List<UUID> uuids, BatchOp batchOp) {
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

            ObjectNode payload = h.mapper.createObjectNode().put("batchName", item.name());
            AssetVersion next = new AssetVersion(
                    asset.getId(), joined.getRevisionId(), item.name(), payload, actor.getId(), Instant.now());
            next.setFolderId(current.getFolderId());
            next.setFolderPath(current.getFolderPath());
            next.setTemplateAssetId(current.getTemplateAssetId());
            next.setDeleted(current.isDeleted());
            h.versionRepository.save(next);

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
        final Fixtures fixtures;
        final ObjectMapper mapper;

        CtxHolder(
                ConfigurableApplicationContext ctx,
                AssetService assets,
                AssetRepository assetRepository,
                AssetVersionRepository versionRepository,
                RevisionRepository revisionRepository,
                RevisionService revisionService,
                Fixtures fixtures,
                ObjectMapper mapper) {
            this.ctx = ctx;
            this.assets = assets;
            this.assetRepository = assetRepository;
            this.versionRepository = versionRepository;
            this.revisionRepository = revisionRepository;
            this.revisionService = revisionService;
            this.fixtures = fixtures;
            this.mapper = mapper;
        }
    }
}
