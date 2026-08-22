package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.UidChangeResult;
import com.acme.staticforge.asset.UidLiteralReference;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Integration test for the §6.4 UID-change warning: renaming an asset's UID must report every
 * template whose OCTL {@code source} still references the old UID literally.
 */
@SpringBootTest
@ActiveProfiles("test")
class UidChangeWarningIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;

    @Test
    void changeUidListsTemplatesReferencingOldUidLiterally() {
        Fixture fx = newFixture();

        TemplateView card = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, "Card",
                        "content { editor text title { } }",
                        Map.of("html", "<p>$CMS_VALUE(title)$</p>"), null, false, null),
                fx.ctx());
        TemplateView teaser = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, "Teaser",
                        "content { editor text headline { } }",
                        Map.of("html", "<div>$CMS_INCLUDE(section_template:card)$</div>"), null, false, null),
                fx.ctx());

        assertThat(assetService.requireCurrent(card.uuid()).uid()).isEqualTo("card");

        UidChangeResult result = assetService.changeUid(card.uuid(), "card_renamed", fx.ctx());

        assertThat(result.oldUid()).isEqualTo("card");
        assertThat(result.newUid()).isEqualTo("card_renamed");
        assertThat(result.affectedTemplates()).usingRecursiveFieldByFieldElementComparator()
                .contains(new UidLiteralReference(
                        teaser.uuid(), teaser.uid(), AssetType.SECTION_TEMPLATE, "Teaser", "html"));
        assertThat(result.affectedTemplates())
                .extracting(UidLiteralReference::assetUuid)
                .doesNotContain(card.uuid());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("uid-user-" + n, "uid-user-" + n + "@example.com", "Uid User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("uidp_" + n, "Uid Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
