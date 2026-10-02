package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Versions are append-only (§7): the page operations that edit a payload in parts — content merge-patch, add,
 * reorder, delete and move of sections — write a new version and leave every earlier one as it was. They once edited
 * the loaded payload in place, so the previous version's row was rewritten with the new content at flush: history
 * lied, and a released version silently took the draft's edits (status stayed {@code PUBLISHED}, the next build
 * published unreleased content). Found by the M27.6 manual check.
 */
@SpringBootTest
@ActiveProfiles("test")
class PagePayloadHistoryIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired PageService pageService;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseStatusService statusService;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, RevisionContext ctx) {
        long id() {
            return project.getId();
        }
    }

    @Test
    @DisplayName("a content merge-patch keeps the released version as released: the page reads CHANGED")
    void patchKeepsHistory() {
        Fixture fx = newFixture();
        AssetVersionView page = page(fx);
        releaseService.release(List.of(new ReleaseItem(page.uuid(), null, null)), fx.ctx());
        AssetVersionView released = assetService.requireCurrent(fx.id(), page.uuid());

        AssetVersionView patched = pageService.patchContent(
                page.uuid(), json("{\"content\":{\"intro\":\"new\"}}"), released.validFromRevision(), fx.ctx());

        assertThat(patched.payload().at("/content/intro").asText()).isEqualTo("new");
        assertThat(payloadAt(fx, page.uuid(), released.validFromRevision()).at("/content/intro").asText()).isEqualTo("old");
        assertThat(statusService.ofAsset(fx.id(), page.uuid()).get("").status()).isEqualTo(ReleaseStatus.CHANGED);
    }

    @Test
    @DisplayName("adding, reordering, deleting and moving sections leave every earlier version untouched")
    void sectionOperationsKeepHistory() {
        Fixture fx = newFixture();
        AssetVersionView section = assetService.create(
                new CreateAssetCommand(fx.id(), AssetType.SECTION_TEMPLATE, "Teaser", null, mapper.createObjectNode(), null),
                fx.ctx());
        AssetVersionView page = page(fx);
        AssetVersionView other = page(fx);

        AssetVersionView one = pageService.addSection(
                page.uuid(), "main", section.uuid().toString(), null, null, null, page.validFromRevision(), fx.ctx());
        AssetVersionView two = pageService.addSection(
                page.uuid(), "main", section.uuid().toString(), null, null, null, one.validFromRevision(), fx.ctx());
        List<String> ids = instanceIds(two);
        AssetVersionView reordered = pageService.reorderSections(
                page.uuid(), "main", List.of(ids.get(1), ids.get(0)), two.validFromRevision(), fx.ctx());
        AssetVersionView deleted = pageService.deleteSection(
                page.uuid(), "main", ids.get(0), reordered.validFromRevision(), fx.ctx());
        pageService.moveSection(page.uuid(), "main", ids.get(1), other.uuid(), "main", null, other.validFromRevision(), fx.ctx());

        assertThat(instanceIds(payloadAt(fx, page.uuid(), page.validFromRevision()))).isEmpty();
        assertThat(instanceIds(payloadAt(fx, page.uuid(), one.validFromRevision()))).containsExactly(ids.get(0));
        assertThat(instanceIds(payloadAt(fx, page.uuid(), two.validFromRevision()))).containsExactly(ids.get(0), ids.get(1));
        assertThat(instanceIds(payloadAt(fx, page.uuid(), reordered.validFromRevision())))
                .containsExactly(ids.get(1), ids.get(0));
        assertThat(instanceIds(payloadAt(fx, page.uuid(), deleted.validFromRevision()))).containsExactly(ids.get(1));
        assertThat(instanceIds(assetService.requireCurrent(fx.id(), page.uuid()).payload())).isEmpty();
        assertThat(instanceIds(payloadAt(fx, other.uuid(), other.validFromRevision()))).isEmpty();
        assertThat(instanceIds(assetService.requireCurrent(fx.id(), other.uuid()).payload())).containsExactly(ids.get(1));
    }

    // ------------------------------------------------------------------

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("pph" + n, "pph" + n + "@example.com", "Admin", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("pph" + n, "pph" + n, null, "page payload history"), admin.getId());
        return new Fixture(project, RevisionContext.of(project.getId(), admin.getId(), "page payload history"));
    }

    private AssetVersionView page(Fixture fx) {
        ObjectNode templatePayload = mapper.createObjectNode();
        templatePayload.putArray("bodies").addObject().put("name", "main");
        AssetVersionView template = assetService.create(
                new CreateAssetCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Layout", null, templatePayload, null), fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());
        ObjectNode payload = page.payload().deepCopy();
        payload.putObject("content").put("intro", "old");
        return pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
    }

    private JsonNode payloadAt(Fixture fx, UUID uuid, long revision) {
        return assetService.findAt(fx.id(), uuid, revision).orElseThrow().payload();
    }

    private static List<String> instanceIds(AssetVersionView version) {
        return instanceIds(version.payload());
    }

    private static List<String> instanceIds(JsonNode payload) {
        return java.util.stream.StreamSupport.stream(payload.at("/bodies/main").spliterator(), false)
                .map(section -> section.path("instanceId").asText())
                .toList();
    }

    private JsonNode json(String text) {
        try {
            return mapper.readTree(text);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
