package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The Globals store's domain service (M17.1.2): a global property set carries its own CDL schema
 * and its values in a single asset, so everything a template has to spread over two assets and a
 * cascade happens here in one version write.
 *
 * <p>These tests exist to pin the three things that make that shape safe rather than merely
 * convenient: a rejected schema never allocates a revision (the counter has no gaps for CDL the
 * user retyped), a {@code renamedFrom} schema change migrates the values <em>inside</em> the same
 * revision (so no observable revision ever shows the new schema next to the old values), and a
 * media value behaves like any other content reference — an {@code asset_reference} row opened on
 * save and closed when the value is cleared (M16.3.1), which is what makes usages, delete
 * protection and incremental rebuilds work for sets at all.
 *
 * <p>Service level on purpose: the role matrix, {@code ETag}/{@code If-Match} headers and problem
 * bodies are {@code GlobalsApiTest}'s subject, and the end-to-end render/publish story is
 * {@code M17GlobalsJourneyIntegrationTest}'s.
 */
@SpringBootTest
@ActiveProfiles("test")
class GlobalSetIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The running example: a text editor with a default, a media editor and a boolean. */
    private static final String SITE_CDL =
            """
            content {
              editor text title { label "Site title" required default "Acme" }
              editor media logo { label "Logo" }
              editor boolean showBanner { label "Show banner" default false }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired GlobalSetService globalSetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetReferenceRepository referenceRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired com.acme.staticforge.asset.AssetVersionRepository assetVersionRepository;

    @Test
    void creatingASetIsOneRevisionTouchingOneAssetAndSeedsTheDeclaredDefaults() {
        Fixture fx = newFixture();
        long revisionsBefore = revisionCount(fx);

        GlobalSetView site = create(fx, "Site");

        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 1);
        assertThat(touchedAssetUuids(fx, site.revision())).containsExactly(site.uuid());
        assertThat(site.uid()).isEqualTo("site");
        assertThat(site.folderPath()).isEqualTo("/" + FolderScope.GLOBALS_ROOT_UID + "/");
        assertThat(site.contentDefinition()).isEqualTo(SITE_CDL);
        assertThat(site.compiledDefinition().path("editors")).isNotEmpty();
        // Only editors that actually declare a default are seeded: `logo` has none, so it stays
        // absent rather than becoming an empty placeholder the validator would have to tolerate.
        assertThat(fieldNames(site.content())).containsExactlyInAnyOrder("title", "showBanner");
        assertThat(site.content().path("title").asText()).isEqualTo("Acme");
        assertThat(site.content().path("showBanner").asBoolean()).isFalse();

        assertThat(globalSetService.list(fx.project().getId(), null))
                .extracting(GlobalSetView::uuid)
                .containsExactly(site.uuid());
    }

    /**
     * The acceptance criterion that a revision is never allocated for CDL that was rejected: the
     * compile happens before {@code AssetService.create} is ever called, so a developer fighting a
     * syntax error doesn't burn one revision id per keystroke.
     */
    @Test
    void invalidCdlIsRejectedWithDiagnosticsAndNoRevisionIsAllocated() {
        Fixture fx = newFixture();
        long revisionsBefore = revisionCount(fx);

        assertThatThrownBy(() -> create(fx, "Broken",
                "content { editor text title { } editor text title { } }"))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(ex.getProblem().getExtensions()).containsEntry("code", "SF-API-0422");
                    assertThat(diagnosticCodes(ex)).isNotEmpty().allMatch(code -> code.startsWith("SF-CDL-"));
                });

        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore);
        assertThat(globalSetService.list(fx.project().getId(), null)).isEmpty();
    }

    /**
     * The property-set-only restrictions ({@code GlobalSetCdlRules}): a body has no page to belong
     * to and a catalog card has no page to render through, so both are {@code SF-CDL-0107} even
     * though the very same CDL compiles cleanly for a template.
     */
    @Test
    void bodiesAndCatalogEditorsAreRejectedWithTheGlobalSetOnlyDiagnostic() {
        Fixture fx = newFixture();

        assertThatThrownBy(() -> create(fx, "With Body",
                """
                content { editor text title { label "Title" } }
                bodies { body main { label "Main" allow ["*"] } }
                """))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(diagnosticCodes(ex))
                        .containsExactly(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET));

        assertThatThrownBy(() -> create(fx, "With Catalog",
                """
                content { editor catalog cards { label "Cards" allow ["teaser"] } }
                """))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(diagnosticCodes(ex))
                        .containsExactly(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET));

        assertThat(globalSetService.list(fx.project().getId(), null)).isEmpty();
    }

    @Test
    void validValuesWriteANewVersionAndAMalformedValueIsRejectedWithFieldIssues() {
        Fixture fx = newFixture();
        GlobalSetView site = create(fx, "Site");

        GlobalSetView saved = globalSetService.updateValues(
                site.uuid(), values(Map.of("title", "Acme Outdoor", "showBanner", true)), site.revision(), fx.ctx());

        assertThat(saved.revision()).isGreaterThan(site.revision());
        assertThat(saved.content().path("title").asText()).isEqualTo("Acme Outdoor");
        assertThat(saved.content().path("showBanner").asBoolean()).isTrue();
        // The schema rides along untouched — values and schema share one asset, not one operation.
        assertThat(saved.contentDefinition()).isEqualTo(site.contentDefinition());

        ObjectNode wrongType = MAPPER.createObjectNode();
        wrongType.putObject("title").put("nope", 1);
        assertThatThrownBy(() -> globalSetService.updateValues(site.uuid(), wrongType, saved.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(issuePaths(ex)).containsExactly("content.title");
                });

        // A media editor holding something that isn't a well-formed MEDIA_REF is structural too.
        ObjectNode badRef = MAPPER.createObjectNode();
        badRef.put("title", "Acme Outdoor");
        badRef.putObject("logo").put("type", "MEDIA_REF").put("uuid", "not-a-uuid");
        assertThatThrownBy(() -> globalSetService.updateValues(site.uuid(), badRef, saved.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(issuePaths(ex)).containsExactly("content.logo"));

        assertThat(globalSetService.find(fx.project().getId(), site.uuid(), null).orElseThrow().revision())
                .as("a rejected save leaves the current version alone")
                .isEqualTo(saved.revision());
    }

    /**
     * M16.3.1 semantics for a set: the media a value points at becomes a real {@code MEDIA_REF}
     * edge in the saving revision, and clearing the value closes that row instead of deleting it —
     * which is how a time-travelled usage list still shows the old dependency.
     */
    @Test
    void aMediaValueOpensAMediaRefEdgeAndClearingItClosesIt() {
        Fixture fx = newFixture();
        GlobalSetView site = create(fx, "Site");
        AssetVersionView logo = media(fx, "Logo");

        ObjectNode withLogo = values(Map.of("title", "Acme Outdoor"));
        withLogo.set("logo", mediaRef(logo.uuid()));
        GlobalSetView linked = globalSetService.updateValues(site.uuid(), withLogo, site.revision(), fx.ctx());

        assertThat(rows(fx, site.uuid(), ReferenceKind.MEDIA_REF)).singleElement().satisfies(row -> {
            assertThat(row.getToAssetId()).isEqualTo(assetId(fx, logo.uuid()));
            assertThat(row.getSourcePath()).isEqualTo("content.logo");
            assertThat(row.getValidFromRevision()).isEqualTo(linked.revision());
            assertThat(row.getValidToRevision()).isNull();
        });

        GlobalSetView cleared = globalSetService.updateValues(
                site.uuid(), values(Map.of("title", "Acme Outdoor")), linked.revision(), fx.ctx());

        assertThat(rows(fx, site.uuid(), ReferenceKind.MEDIA_REF)).singleElement().satisfies(row ->
                assertThat(row.getValidToRevision()).isEqualTo(cleared.revision()));
        assertThat(referenceRepository.findByFromAssetIdAndValidToRevisionIsNull(assetId(fx, site.uuid()))).isEmpty();
    }

    /**
     * §12.3's {@code renamedFrom} for a set. The interesting part is not that the value moves —
     * {@code ContentRenameMigrator} is unit-tested for that — but that the migration lands in the
     * <em>same</em> version write as the schema it follows from: one revision, one touched asset,
     * no intermediate state in which {@code siteTitle} is declared but only {@code title} is set.
     */
    @Test
    void renamingAnEditorMigratesItsValueInTheSameSingleRevision() {
        Fixture fx = newFixture();
        GlobalSetView site = create(fx, "Site");
        GlobalSetView valued = globalSetService.updateValues(
                site.uuid(), values(Map.of("title", "Acme Outdoor", "showBanner", true)), site.revision(), fx.ctx());
        long revisionsBefore = revisionCount(fx);

        GlobalSetView renamed = globalSetService.updateSchema(
                site.uuid(),
                """
                content {
                  editor text siteTitle { label "Site title" required renamedFrom "title" }
                  editor media logo { label "Logo" }
                  editor boolean showBanner { label "Show banner" default false }
                }
                """,
                valued.revision(),
                fx.ctx());

        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 1);
        assertThat(touchedAssetUuids(fx, renamed.revision())).containsExactly(site.uuid());
        assertThat(renamed.content().path("siteTitle").asText()).isEqualTo("Acme Outdoor");
        assertThat(renamed.content().has("title")).isFalse();
        assertThat(renamed.content().path("showBanner").asBoolean()).as("untouched editors keep their value").isTrue();

        // Time travel proves there was no in-between: the revision before the rename still has the
        // old schema together with the old value.
        GlobalSetView before = globalSetService.find(fx.project().getId(), site.uuid(), valued.revision()).orElseThrow();
        assertThat(before.content().path("title").asText()).isEqualTo("Acme Outdoor");
        assertThat(before.contentDefinition()).doesNotContain("siteTitle");
    }

    /**
     * A set owns its own schema, so a value whose editor is gone is genuinely orphaned and is
     * dropped — unlike a page, where an unknown key may simply belong to a section template that
     * isn't the one being edited and is deliberately left alone.
     */
    @Test
    void removingAnEditorDropsItsValue() {
        Fixture fx = newFixture();
        GlobalSetView site = create(fx, "Site");
        GlobalSetView valued = globalSetService.updateValues(
                site.uuid(), values(Map.of("title", "Acme Outdoor", "showBanner", true)), site.revision(), fx.ctx());

        GlobalSetView shrunk = globalSetService.updateSchema(
                site.uuid(),
                "content { editor text title { label \"Site title\" required } }",
                valued.revision(),
                fx.ctx());

        assertThat(fieldNames(shrunk.content())).containsExactly("title");
        assertThat(shrunk.content().path("title").asText()).isEqualTo("Acme Outdoor");
    }

    /** Both mutations use the generic interval check, so both conflict exactly like a page save. */
    @Test
    void aStaleIfMatchRevisionIsRejectedWith409OnBothMutations() {
        Fixture fx = newFixture();
        GlobalSetView site = create(fx, "Site");
        long stale = site.revision();
        globalSetService.updateValues(site.uuid(), values(Map.of("title", "First")), stale, fx.ctx());

        assertThatThrownBy(() ->
                globalSetService.updateValues(site.uuid(), values(Map.of("title", "Second")), stale, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(409);
                    assertThat(ex.getProblem().getExtensions())
                            .containsEntry("code", "SF-API-0409")
                            .containsEntry("expectedRevision", stale);
                    assertThat(ex.getProblem().getExtensions().get("theirs")).isInstanceOf(JsonNode.class);
                });

        assertThatThrownBy(() -> globalSetService.updateSchema(site.uuid(), SITE_CDL, stale, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
    }

    /**
     * {@code FolderScope.requiredFor(GLOBAL_SET)} is {@code GLOBALS}, so the generic scope guard
     * applies to sets with no extra code: a set can neither be born in another store's folder nor
     * be moved into one later.
     */
    @Test
    void aSetCannotBeCreatedInOrMovedIntoAFolderOfAnotherScope() {
        Fixture fx = newFixture();
        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());
        AssetVersionView globalsFolder = folderService.create(null, "Branding", FolderScope.GLOBALS, fx.ctx());

        assertThatThrownBy(() -> globalSetService.create(
                new CreateGlobalSetCommand(fx.project().getId(), pagesFolder.uuid(), "Site", SITE_CDL), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));

        GlobalSetView site = globalSetService.create(
                new CreateGlobalSetCommand(fx.project().getId(), globalsFolder.uuid(), "Site", SITE_CDL), fx.ctx());
        assertThat(site.folderPath()).startsWith("/" + FolderScope.GLOBALS_ROOT_UID + "/");

        assertThatThrownBy(() -> assetService.move(site.uuid(), pagesFolder.uuid(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
        assertThat(globalSetService.find(fx.project().getId(), site.uuid(), null).orElseThrow().folderPath())
                .isEqualTo(site.folderPath());
    }

    /**
     * A project created before M17 has no {@code globals_root} row. The first set created in it
     * must provision one lazily rather than fail or land in the shared hidden root — the same
     * find-or-create pattern the Pages/Media/Navigation roots use — and the provisioning itself
     * must be exactly one revision, not one per ancestor.
     */
    @Test
    void theGlobalsRootIsProvisionedLazilyForAProjectThatPredatesIt() {
        Fixture fx = newFixture();
        dropGlobalsRoot(fx);
        long revisionsBefore = revisionCount(fx);

        GlobalSetView site = create(fx, "Site");

        assertThat(site.folderPath()).isEqualTo("/" + FolderScope.GLOBALS_ROOT_UID + "/");
        // Two revisions: the lazily created root (one revision covering just that folder, exactly
        // like the Navigation/Pages/Media roots outside a project-create batch) and the set itself.
        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 2);
        assertThat(touchedAssetUuids(fx, site.revision())).containsExactly(site.uuid());
        assertThat(touchedAssetUuids(fx, site.revision() - 1))
                .containsExactly(globalsRoot(fx).orElseThrow().getUuid());
    }

    // ------------------------------------------------------------------
    // Fixtures and helpers
    // ------------------------------------------------------------------

    private GlobalSetView create(Fixture fx, String displayName) {
        return create(fx, displayName, SITE_CDL);
    }

    private GlobalSetView create(Fixture fx, String displayName, String cdl) {
        return globalSetService.create(
                new CreateGlobalSetCommand(fx.project().getId(), null, displayName, cdl), fx.ctx());
    }

    private AssetVersionView media(Fixture fx, String displayName) {
        return assetService.create(
                new CreateAssetCommand(
                        fx.project().getId(), AssetType.MEDIA, displayName, null, MAPPER.createObjectNode(), null),
                fx.ctx());
    }

    private static ObjectNode values(Map<String, Object> entries) {
        ObjectNode content = MAPPER.createObjectNode();
        entries.forEach((key, value) -> {
            if (value instanceof Boolean flag) {
                content.put(key, flag);
            } else {
                content.put(key, String.valueOf(value));
            }
        });
        return content;
    }

    private static ObjectNode mediaRef(UUID mediaUuid) {
        return MAPPER.createObjectNode().put("type", "MEDIA_REF").put("uuid", mediaUuid.toString());
    }

    private static List<String> fieldNames(JsonNode content) {
        List<String> names = new java.util.ArrayList<>();
        content.fieldNames().forEachRemaining(names::add);
        return names;
    }

    @SuppressWarnings("unchecked")
    private static List<String> diagnosticCodes(SfException ex) {
        Object diagnostics = ex.getProblem().getExtensions().get("diagnostics");
        assertThat(diagnostics).as("problem carries diagnostics").isInstanceOf(List.class);
        return ((List<com.acme.staticforge.template.diagnostic.Diagnostic>) diagnostics)
                .stream().map(com.acme.staticforge.template.diagnostic.Diagnostic::code).toList();
    }

    @SuppressWarnings("unchecked")
    private static List<String> issuePaths(SfException ex) {
        Object issues = ex.getProblem().getExtensions().get("issues");
        assertThat(issues).as("problem carries field-level issues").isInstanceOf(List.class);
        return ((List<com.acme.staticforge.asset.content.ContentIssue>) issues)
                .stream().map(com.acme.staticforge.asset.content.ContentIssue::path).toList();
    }

    private long assetId(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.project().getId(), uuid).map(Asset::getId).orElseThrow();
    }

    private List<AssetReference> rows(Fixture fx, UUID from, ReferenceKind kind) {
        return referenceRepository.findByFromAssetId(assetId(fx, from)).stream()
                .filter(row -> row.getKind() == kind)
                .toList();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    /** The asset uuids listed in a revision's {@code summary.assets} (see {@code AssetChange}). */
    private List<UUID> touchedAssetUuids(Fixture fx, long revisionId) {
        Revision revision = revisionRepository
                .findByProjectIdAndRevisionId(fx.project().getId(), revisionId)
                .orElseThrow();
        List<UUID> uuids = new java.util.ArrayList<>();
        revision.getSummary().path("assets").forEach(entry -> uuids.add(UUID.fromString(entry.path("uuid").asText())));
        return uuids;
    }

    private java.util.Optional<Asset> globalsRoot(Fixture fx) {
        return assetRepository.findByProjectIdAndAssetTypeAndUid(
                fx.project().getId(), AssetType.FOLDER, FolderScope.GLOBALS_ROOT_UID);
    }

    /**
     * Turns a fresh project into a pre-M17 one by removing the eagerly provisioned
     * {@code globals_root} folder and its single version outright — not a soft delete, which would
     * leave a row {@code ensureFixedFolder} still finds.
     */
    private void dropGlobalsRoot(Fixture fx) {
        Asset root = globalsRoot(fx).orElseThrow();
        assetVersionRepository.deleteAll(assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(root.getId()));
        assetRepository.delete(root);
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "globalset-user-" + n, "globalset-user-" + n + "@example.com", "Global Set User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("globalsetp_" + n, "Global Set Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
