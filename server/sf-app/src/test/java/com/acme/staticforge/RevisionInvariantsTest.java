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
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Property-based revision invariants (spec §25.5). Random sequences of mutations must
 * yield gapless revision ids and at most one valid version per asset per revision.
 */
class RevisionInvariantsTest {

    private static CtxHolder holder;

    @Property(tries = 25)
    void randomMutationSequencesAreRevisionSafe(@ForAll("ops") List<UpdateOp> ops) {
        CtxHolder h = context();
        ObjectNode payload = h.mapper.createObjectNode().put("seed", "x");

        AppUser actor = h.fixtures.user("u-" + suffix());
        Project project = h.fixtures.project("p-" + suffix(), actor);

        List<UUID> uuids = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            AssetVersionView created = h.assets.create(
                    new CreateAssetCommand(
                            project.getId(), AssetType.FOLDER, "f" + i, null, h.mapper.createObjectNode(), null),
                    RevisionContext.of(project.getId(), actor.getId(), "create"));
            uuids.add(created.uuid());
        }

        for (UpdateOp op : ops) {
            UUID uuid = uuids.get(op.index());
            long expected = h.assets.requireCurrent(uuid).validFromRevision();
            h.assets.update(
                    uuid,
                    new UpdateAssetCommand(op.name(), payload.deepCopy()),
                    expected,
                    RevisionContext.of(project.getId(), actor.getId(), "update"));
        }

        List<Revision> revisions = h.revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId());
        Set<Long> ids = new HashSet<>();
        revisions.forEach(r -> ids.add(r.getRevisionId()));

        long n = ids.size();
        for (long r = 1; r <= n; r++) {
            assertThat(ids).as("revision %s present", r).contains(r);
        }

        for (UUID uuid : uuids) {
            Asset asset = h.assetRepository.findByUuid(uuid).orElseThrow();
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

    @Provide
    Arbitrary<List<UpdateOp>> ops() {
        Arbitrary<UpdateOp> op = Combinators.combine(
                        Arbitraries.integers().between(0, 3),
                        Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(12))
                .as(UpdateOp::new);
        return op.list().ofMinSize(1).ofMaxSize(10);
    }

    private record UpdateOp(int index, String name) {}

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
        final Fixtures fixtures;
        final ObjectMapper mapper;

        CtxHolder(
                ConfigurableApplicationContext ctx,
                AssetService assets,
                AssetRepository assetRepository,
                AssetVersionRepository versionRepository,
                RevisionRepository revisionRepository,
                Fixtures fixtures,
                ObjectMapper mapper) {
            this.ctx = ctx;
            this.assets = assets;
            this.assetRepository = assetRepository;
            this.versionRepository = versionRepository;
            this.revisionRepository = revisionRepository;
            this.fixtures = fixtures;
            this.mapper = mapper;
        }
    }
}
