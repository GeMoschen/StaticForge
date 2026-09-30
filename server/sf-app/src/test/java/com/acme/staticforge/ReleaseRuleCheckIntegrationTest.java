package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetRelease;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The release rule gate (M33.6): {@code error} blocks ({@code SF-DOM-0150}), {@code warning} needs
 * {@code acceptWarnings} ({@code SF-DOM-0156}), {@code info} never blocks; a {@code release} fill stores a new
 * version in the release's own revision and releases it; rules read the released state, and what the same release
 * releases counts as released; each released language is checked on its own.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReleaseRuleCheckIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL = """
            content {
              editor text headline { }
              editor text stamp { }
              editor text note { }
            }
            rules {
              rule "no-tbd" on headline {
                level error  scope [release]
                assert "value != 'TBD'"
                message { en "Replace the placeholder" }
              }
              rule "short" on headline {
                level warning  scope [release]
                assert "length(value) <= 10"
                message { en "Long headline" }
              }
              rule "note" on note {
                level info  scope [release]
                assert "!isEmpty(value)"
                message { en "No note" }
              }
              fill stamp { value "'released'"  mode empty  on [release] }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository versionRepository;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired FolderService folderService;
    @Autowired GlobalSetService globalSetService;
    @Autowired ReleaseService releases;
    @Autowired AssetReleaseRepository releaseRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser user, RevisionContext ctx) {
        long id() {
            return project.getId();
        }
    }

    @Test
    @DisplayName("a release-scope error blocks with SF-DOM-0150 and writes nothing")
    void errorBlocks() {
        Fixture fx = newFixture("rr-err");
        UUID page = page(fx, template(fx, CDL), "Home", c -> c.put("headline", "TBD").put("note", "n"));
        long revisions = revisionCount(fx);

        assertThatThrownBy(() -> releases.release(List.of(ReleaseItem.of(page)), true, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0150");
                    assertThat(e.getProblem().getExtensions().get("assets").toString()).contains("no-tbd");
                });
        assertThat(revisionCount(fx)).isEqualTo(revisions);
        assertThat(releases.plan(fx.id(), List.of(ReleaseItem.of(page))).incomplete()).hasSize(1);
    }

    @Test
    @DisplayName("a warning needs acceptWarnings (SF-DOM-0156); accepted, the outcome lists it; an info never blocks")
    void warningsNeedAcceptingInfosNeverBlock() {
        Fixture fx = newFixture("rr-warn");
        UUID page = page(fx, template(fx, CDL), "Home", c -> c.put("headline", "A rather long headline"));

        ReleasePlan plan = releases.plan(fx.id(), List.of(ReleaseItem.of(page)));
        assertThat(plan.incomplete()).isEmpty();
        assertThat(plan.warningFindings()).singleElement()
                .satisfies(w -> assertThat(w.issues()).extracting(i -> i.rule()).containsExactly("short"));
        assertThat(plan.infoFindings()).singleElement()
                .satisfies(i -> assertThat(i.issues()).extracting(f -> f.rule()).containsExactly("note"));

        assertThatThrownBy(() -> releases.release(List.of(ReleaseItem.of(page)), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getProblem().getStatus()).isEqualTo(422);
                    assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0156");
                });

        ReleaseOutcome outcome = releases.release(List.of(ReleaseItem.of(page)), true, fx.ctx());
        assertThat(outcome.applied()).hasSize(1);
        assertThat(outcome.warnings()).singleElement()
                .satisfies(w -> assertThat(w.issues()).extracting(i -> i.rule()).containsExactly("short"));
    }

    @Test
    @DisplayName("a release fill stores one new version in the release's revision and releases that version")
    void releaseFillWritesAndReleasesANewVersion() {
        Fixture fx = newFixture("rr-fill");
        UUID page = page(fx, template(fx, CDL), "Home", c -> c.put("headline", "Hi").put("note", "n"));
        long draftBefore = openVersionId(fx, page);

        ReleasePlan plan = releases.plan(fx.id(), List.of(ReleaseItem.of(page)));
        assertThat(plan.fills()).singleElement().satisfies(fill -> {
            assertThat(fill.assetUuid()).isEqualTo(page);
            assertThat(fill.path()).isEqualTo("content.stamp");
            assertThat(fill.value().asText()).isEqualTo("released");
        });
        long revisions = revisionCount(fx);

        ReleaseOutcome outcome = releases.release(List.of(ReleaseItem.of(page)), fx.ctx());

        assertThat(revisionCount(fx)).as("one revision for the fill and the release").isEqualTo(revisions + 1);
        long draftAfter = openVersionId(fx, page);
        assertThat(draftAfter).isNotEqualTo(draftBefore);
        assertThat(versionRepository.findById(draftAfter).orElseThrow().getValidFromRevision()).isEqualTo(outcome.revision());
        assertThat(assetService.requireCurrent(fx.id(), page).payload().at("/content/stamp").asText()).isEqualTo("released");
        assertThat(pointer(fx, page).getReleasedVersionId()).isEqualTo(draftAfter);

        // Filled once: the next release has nothing to fill, and the page is published as is.
        assertThat(releases.plan(fx.id(), List.of(ReleaseItem.of(page))).fills()).isEmpty();
    }

    @Test
    @DisplayName("rules read property sets as released — or as the same release releases them")
    void rulesReadTheReleasedState() {
        Fixture fx = newFixture("rr-glob");
        AssetVersionView folder = folderService.create(null, "Branding", FolderScope.GLOBALS, fx.ctx());
        GlobalSetView site = globalSetService.create(new CreateGlobalSetCommand(
                fx.id(), folder.uuid(), "Site", CdlSources.split("content { editor text title { } }")), fx.ctx());
        globalSetService.updateValues(site.uuid(), mapper.createObjectNode().put("title", "Acme"), site.revision(), fx.ctx());
        TemplateView template = template(fx, """
                content { editor text headline { } }
                rules {
                  rule "site-title" on page {
                    level error  scope [release]
                    assert "!isEmpty(global:%s.title)"
                    message { en "Release the site title first" }
                  }
                }
                """.formatted(site.uid()));
        UUID page = page(fx, template, "Home", c -> c.put("headline", "Hi"));

        // The set's draft has a title, but nothing is released: the rule sees no title.
        assertThatThrownBy(() -> releases.release(List.of(ReleaseItem.of(page)), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e ->
                        assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0150"));

        // Released together, the set counts as released.
        assertThat(releases.plan(fx.id(), List.of(ReleaseItem.of(page), ReleaseItem.of(site.uuid()))).incomplete())
                .isEmpty();
        ReleaseOutcome outcome = releases.release(List.of(ReleaseItem.of(page), ReleaseItem.of(site.uuid())), fx.ctx());
        assertThat(outcome.applied()).hasSize(2);
    }

    @Test
    @DisplayName("a multi-language release checks each released language")
    void eachReleasedLanguageIsChecked() {
        Fixture fx = newFixture("rr-loc");
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "de"), new ProjectLocale("en", "en")), "de", Map.of(), false),
                true, fx.ctx());
        TemplateView template = template(fx, """
                content { editor text headline { localizable } }
                rules {
                  rule "no-tbd" on headline {
                    level error  scope [release]
                    assert "value != 'TBD'"
                    message { en "Replace the placeholder" }
                    locales all
                  }
                }
                """);
        UUID page = page(fx, template, "Home", c -> c.set("headline", mapper.createObjectNode()
                .put("type", "L10N")
                .set("values", mapper.createObjectNode().put("de", "Hallo").put("en", "TBD"))));

        assertThatThrownBy(() -> releases.release(List.of(ReleaseItem.of(page, "en")), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0150");
                    assertThat(e.getProblem().getExtensions().get("assets").toString()).contains("locale=en");
                });
        ReleaseOutcome de = releases.release(List.of(ReleaseItem.of(page, "de")), fx.ctx());
        assertThat(de.applied()).extracting(t -> t.locale()).containsExactly("de");
    }

    @Test
    @DisplayName("a template without rules releases exactly as before")
    void withoutRulesNothingChanges() {
        Fixture fx = newFixture("rr-none");
        UUID page = page(fx, template(fx, "content { editor text headline { required } }"), "Home", c -> c.put("headline", "Hi"));
        long draft = openVersionId(fx, page);

        ReleasePlan plan = releases.plan(fx.id(), List.of(ReleaseItem.of(page)));
        assertThat(plan.warningFindings()).isEmpty();
        assertThat(plan.infoFindings()).isEmpty();
        assertThat(plan.fills()).isEmpty();
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());
        assertThat(openVersionId(fx, page)).isEqualTo(draft);
        assertThat(pointer(fx, page).getReleasedVersionId()).isEqualTo(draft);
        assertThat(pointer(fx, page).getLocaleKey()).isEqualTo(ReleaseLocales.ALL);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Release rules", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "release rules"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "release rules"));
    }

    private TemplateView template(Fixture fx, String cdl) {
        return templateService.create(new CreateTemplateCommand(
                        fx.id(), AssetType.PAGE_TEMPLATE, "Article" + SEQ.incrementAndGet(), CdlSources.split(cdl),
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"), null, false, Map.of()),
                fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name, Consumer<ObjectNode> content) {
        UUID page = pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = (ObjectNode) current.payload().deepCopy();
        content.accept(payload.withObject("content"));
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
        return page;
    }

    private long assetId(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.id(), uuid).orElseThrow().getId();
    }

    private long openVersionId(Fixture fx, UUID uuid) {
        return versionRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, uuid)).orElseThrow().getId();
    }

    private AssetRelease pointer(Fixture fx, UUID uuid) {
        long assetId = assetId(fx, uuid);
        return releaseRepository.findByProjectIdAndValidToRevisionIsNull(fx.id()).stream()
                .filter(p -> p.getAssetId().equals(assetId))
                .findFirst()
                .orElseThrow();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }
}
