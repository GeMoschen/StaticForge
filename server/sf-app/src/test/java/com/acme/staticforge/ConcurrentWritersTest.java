package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
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
                            long expected = assets.requireCurrent(folder.uuid()).validFromRevision();
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

        Asset asset = assetRepository.findByUuid(folder.uuid()).orElseThrow();
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

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
