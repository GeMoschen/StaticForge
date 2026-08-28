package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.SfException;
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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Concurrency harness (spec §25.5 invariant 5): concurrent writers on the same asset
 * produce a total order with no lost updates and no revision gaps. Each write either
 * commits at a fresh revision or fails with 409 (retried).
 */
@SpringBootTest
@ActiveProfiles("test")
class ConcurrentWritersTest {

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository versionRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired RevisionService revisionService;
    @Autowired PlatformTransactionManager txManager;

    @Test
    void concurrentWritersProduceNoLostUpdates() throws Exception {
        Fixtures f = new Fixtures(users, projects, assets);
        AppUser actor = f.user("cw-" + suffix());
        Project project = f.project("cp-" + suffix(), actor);
        AssetVersionView folder = f.folder(project, actor, "shared");
        var payload = new ObjectMapper().createObjectNode().put("d", "v");

        int writers = 8;
        int each = 6;
        int total = writers * each;

        try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> futures = new ArrayList<>();
            for (int w = 0; w < writers; w++) {
                final int wi = w;
                futures.add(exec.submit(() -> {
                    for (int i = 0; i < each; i++) {
                        boolean committed = false;
                        while (!committed) {
                            long expected = assets.requireCurrent(project.getId(), folder.uuid()).validFromRevision();
                            try {
                                assets.update(
                                        folder.uuid(),
                                        new UpdateAssetCommand("w" + wi + "-" + i, payload.deepCopy()),
                                        expected,
                                        RevisionContext.of(project.getId(), actor.getId(), "write"));
                                committed = true;
                            } catch (SfException e) {
                                if (e.getStatus() == 409) {
                                    continue; // optimistic conflict; retry at the newer revision
                                }
                                throw e;
                            }
                        }
                    }
                }));
            }
            for (Future<?> future : futures) {
                future.get();
            }
        }

        Asset asset = assetRepository.findByProjectIdAndUuid(project.getId(), folder.uuid()).orElseThrow();
        List<AssetVersion> versions = versionRepository.findByAssetIdOrderByValidFromRevisionDesc(asset.getId());
        assertThat(versions).as("one version per create + each update").hasSize(total + 1);

        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId());
        Set<Long> ids = new HashSet<>();
        revisions.forEach(r -> ids.add(r.getRevisionId()));
        long n = ids.size();
        for (long r = 1; r <= n; r++) {
            assertThat(ids).as("revision %s present (gapless)", r).contains(r);
        }
    }

    /**
     * `M15.3.1`: mixes concurrent compound (batch) revisions with concurrent ordinary
     * single-asset writers against an OVERLAPPING asset — every batch and every single
     * writer both touch the same shared folder, alongside their own disjoint private
     * asset(s) — proving invariant 5 (no lost updates) holds not only among single-asset
     * writers (already covered by {@link #concurrentWritersProduceNoLostUpdates}) but
     * when a batch (opened via {@code RevisionService#beginBatch}/{@code #allocateOrJoin},
     * spec §7.1) races against them too. A single writer's optimistic {@code
     * expectedRevision} check still serializes correctly against a concurrently-committed
     * batch (retried on 409, exactly like against another single writer) because both
     * paths allocate through the same per-project counter row lock
     * ({@code RevisionCounterRepository#nextRevision}).
     */
    @Test
    void concurrentBatchesAndSingleWritersProduceNoLostUpdates() throws Exception {
        Fixtures f = new Fixtures(users, projects, assets);
        AppUser actor = f.user("cwb-" + suffix());
        Project project = f.project("cbp-" + suffix(), actor);
        AssetVersionView shared = f.folder(project, actor, "shared");
        var payload = new ObjectMapper().createObjectNode().put("d", "v");

        int singleWriters = 4;
        int singleWritesEach = 4;
        int batchers = 3;

        // Every batcher's own private folder, pre-created outside the race so each batch's
        // loop only ever has to *write* new versions, never create the private half of its
        // pair mid-race.
        List<AssetVersionView> privateFolders = new ArrayList<>();
        for (int b = 0; b < batchers; b++) {
            privateFolders.add(f.folder(project, actor, "private-" + b));
        }

        try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> futures = new ArrayList<>();

            for (int w = 0; w < singleWriters; w++) {
                final int wi = w;
                futures.add(exec.submit(() -> {
                    for (int i = 0; i < singleWritesEach; i++) {
                        boolean committed = false;
                        while (!committed) {
                            long expected = assets.requireCurrent(project.getId(), shared.uuid()).validFromRevision();
                            try {
                                assets.update(
                                        shared.uuid(),
                                        new UpdateAssetCommand("sw" + wi + "-" + i, payload.deepCopy()),
                                        expected,
                                        RevisionContext.of(project.getId(), actor.getId(), "write"));
                                committed = true;
                            } catch (SfException e) {
                                if (e.getStatus() == 409) {
                                    continue; // optimistic conflict, incl. against a concurrent batch; retry
                                }
                                throw e;
                            }
                        }
                    }
                }));
            }

            for (int b = 0; b < batchers; b++) {
                final int bi = b;
                final UUID privateUuid = privateFolders.get(b).uuid();
                futures.add(exec.submit(() -> commitBatch(project, actor, List.of(shared.uuid(), privateUuid), "batch" + bi)));
            }

            for (Future<?> future : futures) {
                future.get();
            }
        }

        int totalSharedWrites = singleWriters * singleWritesEach + batchers;
        Asset sharedAsset = assetRepository.findByProjectIdAndUuid(project.getId(), shared.uuid()).orElseThrow();
        List<AssetVersion> sharedVersions =
                versionRepository.findByAssetIdOrderByValidFromRevisionDesc(sharedAsset.getId());
        assertThat(sharedVersions)
                .as("no lost updates on the overlapping asset: one version per create + each single write + each batch")
                .hasSize(totalSharedWrites + 1);

        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId());
        Set<Long> ids = new HashSet<>();
        revisions.forEach(r -> ids.add(r.getRevisionId()));
        long n = ids.size();
        for (long r = 1; r <= n; r++) {
            assertThat(ids).as("revision %s present (gapless even with batches interleaved)", r).contains(r);
        }

        // Each batch consumed exactly one revision for its (shared, private) pair, not two.
        for (int b = 0; b < batchers; b++) {
            Asset privateAsset =
                    assetRepository.findByProjectIdAndUuid(project.getId(), privateFolders.get(b).uuid()).orElseThrow();
            AssetVersion privateCurrent =
                    versionRepository.findByAssetIdAndValidToRevisionIsNull(privateAsset.getId()).orElseThrow();
            boolean sharedTouchedSameRevision = sharedVersions.stream()
                    .anyMatch(v -> v.getValidFromRevision() == privateCurrent.getValidFromRevision());
            assertThat(sharedTouchedSameRevision)
                    .as("batch %s's private and shared writes share one revision", b)
                    .isTrue();
        }
    }

    /**
     * Commits one compound batch touching every {@code uuid} in {@code targets} as a
     * single revision, mirroring the real orchestrating pattern ({@code
     * TemplateServiceImpl.migrateRenames}/{@code ProjectServiceImpl.create}): one {@code
     * beginBatch}, then one {@code allocateOrJoin} + close/insert/appendSummary per asset,
     * all wrapped in one transaction so the batch is atomic against concurrent readers.
     */
    private void commitBatch(Project project, AppUser actor, List<UUID> targets, String label) {
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            Revision batch = revisionService.beginBatch(project.getId(), ChangeType.UPDATE, label, actor.getId());
            RevisionContext batchCtx = RevisionContext.joining(batch, actor.getId(), label);

            for (UUID uuid : targets) {
                Asset asset = assetRepository.findByProjectIdAndUuid(project.getId(), uuid).orElseThrow();
                AssetVersion current =
                        versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()).orElseThrow();

                Revision joined = revisionService.allocateOrJoin(batchCtx, ChangeType.UPDATE);
                current.setValidToRevision(joined.getRevisionId());
                versionRepository.save(current);

                ObjectNode payload = new ObjectMapper().createObjectNode().put("batch", label);
                AssetVersion next = new AssetVersion(
                        asset.getId(), joined.getRevisionId(), label, payload, actor.getId(), Instant.now());
                next.setFolderId(current.getFolderId());
                next.setFolderPath(current.getFolderPath());
                next.setTemplateAssetId(current.getTemplateAssetId());
                next.setDeleted(current.isDeleted());
                versionRepository.save(next);

                revisionService.appendSummary(
                        project.getId(),
                        joined.getRevisionId(),
                        AssetChange.create(asset.getUuid().toString(), AssetType.FOLDER.name(), "UPDATE", List.of("payload")));
            }
        });
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
