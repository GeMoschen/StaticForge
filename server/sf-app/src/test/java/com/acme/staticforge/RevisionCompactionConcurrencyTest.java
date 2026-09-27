package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.reference.ReferenceEdge;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.revision.compaction.RevisionCompactor;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Compaction while the project is being edited (M29.4.2, {@code ConcurrentWritersTest}-style): 8 writers save to the
 * very pages a compaction is rewriting, one asset per batch so the two interleave. No save is lost, nothing
 * deadlocks, compaction removes exactly the old versions, and the revision invariants hold afterwards.
 */
@SpringBootTest
@ActiveProfiles("test")
class RevisionCompactionConcurrencyTest {

    private static final int PAGES = 30;
    private static final int OLD_VERSIONS = 6;
    private static final int WRITERS = 8;
    private static final int WRITES_EACH = 6;

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired RevisionRepository revisions;
    @Autowired ReferenceMaterializer materializer;
    @Autowired RevisionCompactor compactor;
    @Autowired CompactionFixtures history;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("8 writers saving while compaction runs: no lost update, no deadlock, invariants hold")
    void writersAndCompactionInterleave() throws Exception {
        Fixtures f = new Fixtures(users, projects, assets);
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        AppUser actor = f.user("cc-" + suffix);
        Project project = f.project("ccp-" + suffix, actor);
        RevisionContext ctx = RevisionContext.of(project.getId(), actor.getId(), "concurrent compaction");
        List<UUID> media = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            media.add(assets.create(new CreateAssetCommand(
                    project.getId(), AssetType.MEDIA, "m" + i, null, mapper.createObjectNode(), null), ctx).uuid());
        }
        List<UUID> pages = new ArrayList<>();
        for (int i = 0; i < PAGES; i++) {
            UUID page = assets.create(new CreateAssetCommand(
                    project.getId(), AssetType.PAGE, "p" + i, null, payload("p" + i, media), null), ctx).uuid();
            for (int v = 2; v <= OLD_VERSIONS; v++) {
                save(project, page, "p" + i + "v" + v, media, ctx);
            }
            pages.add(page);
        }
        long dayEnd = history.head(project.getId());
        for (UUID page : pages) {
            save(project, page, "next day", media, ctx);
        }
        long before = history.head(project.getId());
        history.backdate(project.getId(), 1, dayEnd, CompactionFixtures.DAY_1);
        history.backdate(project.getId(), dayEnd + 1, before, CompactionFixtures.DAY_1.plus(Duration.ofDays(1)));
        Instant cutoff = CompactionFixtures.DAY_1.plus(Duration.ofDays(60));

        Map<UUID, Set<String>> committed = new ConcurrentHashMap<>();
        AtomicLong removed = new AtomicLong();
        AtomicBoolean writing = new AtomicBoolean(true);
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> writers = new ArrayList<>();
            for (int w = 0; w < WRITERS; w++) {
                int wi = w;
                writers.add(exec.submit(() -> {
                    start.await();
                    for (int i = 0; i < WRITES_EACH; i++) {
                        UUID page = pages.get(ThreadLocalRandom.current().nextInt(PAGES));
                        String name = "w" + wi + "-" + i + (ThreadLocalRandom.current().nextBoolean() ? "h" : "g");
                        while (true) {
                            try {
                                save(project, page, name, media, RevisionContext.of(project.getId(), actor.getId(), "write"));
                                committed.computeIfAbsent(page, p -> ConcurrentHashMap.newKeySet()).add(name);
                                break;
                            } catch (SfException e) {
                                if (e.getStatus() != 409) {
                                    throw e;
                                }
                            }
                        }
                    }
                    return null;
                }));
            }
            Future<?> compaction = exec.submit(() -> {
                start.await();
                do {
                    removed.addAndGet(compactor.compact(project.getId(), cutoff, false, 1, null).versionsRemoved());
                } while (writing.get());
                return null;
            });
            start.countDown();
            for (Future<?> writer : writers) {
                writer.get(120, TimeUnit.SECONDS);
            }
            writing.set(false);
            compaction.get(120, TimeUnit.SECONDS);
        }

        long head = history.head(project.getId());
        assertThat(removed.get()).as("every old version but the last of its day").isEqualTo((long) PAGES * (OLD_VERSIONS - 1));
        int written = 0;
        for (UUID page : pages) {
            long assetId = history.assetId(project.getId(), page);
            List<AssetVersion> versions = history.versions(assetId);
            Set<String> names = new HashSet<>();
            versions.forEach(v -> names.add(v.getDisplayName()));
            Set<String> mine = committed.getOrDefault(page, Set.of());
            written += mine.size();
            assertThat(names).as("no lost update on %s", page).containsAll(mine);
            assertThat(versions).as("last old version + next day + the writes").hasSize(2 + mine.size());
            history.assertGapless(assetId, head);
            Map<Long, Set<ReferenceEdge>> edges = history.edgesAt(assetId, head);
            history.versionAt(assetId, head).forEach((r, v) -> assertThat(edges.get(r))
                    .as("edges of %s at r%s", page, r)
                    .isEqualTo(materializer.extract(project.getId(), AssetType.PAGE, v.getPayload())));
        }
        assertThat(written).isEqualTo(WRITERS * WRITES_EACH);
        Set<Long> ids = new HashSet<>();
        revisions.findByProjectIdOrderByRevisionIdDesc(project.getId()).stream().map(Revision::getRevisionId).forEach(ids::add);
        for (long r = 1; r <= head; r++) {
            assertThat(ids).as("revision %s present (gapless)", r).contains(r);
        }
    }

    private void save(Project project, UUID page, String name, List<UUID> media, RevisionContext ctx) {
        long expected = assets.requireCurrent(project.getId(), page).validFromRevision();
        assets.update(page, new UpdateAssetCommand(name, payload(name, media)), expected, ctx);
    }

    /** A page payload referencing media 0 when the name ends in "h", media 1 when it ends in "g" or contains "v". */
    private ObjectNode payload(String name, List<UUID> media) {
        ObjectNode payload = mapper.createObjectNode().put("name", name);
        ObjectNode content = payload.putObject("content");
        if (name.endsWith("h") || name.hashCode() % 2 == 0) {
            content.putObject("hero").put("type", "MEDIA_REF").put("uuid", media.get(0).toString());
        }
        if (name.endsWith("g") || name.contains("v")) {
            content.putArray("gallery").addObject().put("type", "MEDIA_REF").put("uuid", media.get(1).toString());
        }
        return payload;
    }
}
