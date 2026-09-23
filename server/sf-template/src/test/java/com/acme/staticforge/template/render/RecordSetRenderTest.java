package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.octl.RecordSetReads;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * {@code M25.2.2}: compiling and rendering record sets — {@code $CMS_VALUE(recordset:uid)$}, set loops, a
 * {@code reference} editor pointing at a set — and their diagnostics, guard rails and dependencies. The rendered
 * output of the regular cases is pinned by the {@code recordset-*} golden files.
 */
class RecordSetRenderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID TEAM = UUID.fromString("d0000000-0000-0000-0000-000000000001");
    private static final UUID LEADS = UUID.fromString("f0000000-0000-0000-0000-000000000001");
    private static final UUID LOOP = UUID.fromString("f0000000-0000-0000-0000-000000000002");
    private static final UUID GONE = UUID.fromString("f0000000-0000-0000-0000-000000000003");

    private static final ContentDefinition TEAM_SCHEMA = new CdlCompiler().compile("""
            content {
              editor text name { label "Name" }
              editor select role { label "Role" options [ { value "lead", label "Lead" }, { value "dev", label "Dev" } ] }
              editor reference featured { label "Featured" assetTypes [RECORD_SET] }
            }
            """).definition();

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    /** The template-save resolver: knows the sets, their dataset and the dataset's schema. */
    private final ReferenceResolver saveResolver = new ReferenceResolver() {
        @Override
        public Optional<UUID> resolve(String assetType, String uid) {
            return switch (assetType + ":" + uid) {
                case "dataset:team" -> Optional.of(TEAM);
                case "recordset:leads" -> Optional.of(LEADS);
                case "recordset:loop" -> Optional.of(LOOP);
                case "recordset:gone" -> Optional.of(GONE);
                default -> Optional.empty();
            };
        }

        @Override
        public Optional<ContentDefinition> datasetDefinition(UUID datasetUuid) {
            return TEAM.equals(datasetUuid) ? Optional.of(TEAM_SCHEMA) : Optional.empty();
        }

        @Override
        public Optional<UUID> recordSetDataset(UUID setUuid) {
            return LEADS.equals(setUuid) || LOOP.equals(setUuid) ? Optional.of(TEAM) : Optional.empty();
        }
    };

    // ------------------------------------------------------------------
    // Compile
    // ------------------------------------------------------------------

    @Test
    void aPathlessSetValueIsNotACrossAssetValueWithoutPath() {
        OctlResult result = compile("$CMS_VALUE(recordset:leads)$$CMS_VALUE(dataset:team)$");

        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH);
        assertThat(result.diagnostics().get(0).message()).contains("dataset:team");
    }

    @Test
    void anUnknownSetUidIsAnUnresolvableReference() {
        assertThat(codes(compile("$CMS_VALUE(recordset:nope)$"))).containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
        assertThat(codes(compile("$CMS_FOR(m : recordset:nope)$x$CMS_END_FOR$")))
                .containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
    }

    @Test
    void folderOnASetLoopIsRejectedTheSetIsTheScope() {
        OctlResult result = compile("$CMS_FOR(m : recordset:leads, folder=\"team\")$x$CMS_END_FOR$");

        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_DATASET_QUERY);
        assertThat(result.diagnostics().get(0).message()).contains("folder").contains("recordset:leads");
        assertThat(compile("$CMS_FOR(m : featured, folder=\"team\")$x$CMS_END_FOR$", TEAM_SCHEMA).diagnostics())
                .filteredOn(d -> d.severity() == Severity.ERROR)
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_DATASET_QUERY);
    }

    @Test
    void setLoopFieldsAreCheckedAgainstTheSetsDatasetOnSave() {
        OctlResult result = compile("$CMS_FOR(m : recordset:leads, where=\"m.nope == 1\", sort=\"featured\")$x$CMS_END_FOR$");

        assertThat(codes(result)).containsExactly(
                DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD, DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD);
        assertThat(result.diagnostics().get(0).message()).contains("nope");
        // Without the save-time resolver (generation, preview) the fields are not checked.
        assertThat(compiler.compile("$CMS_FOR(m : recordset:leads, where=\"m.nope == 1\")$x$CMS_END_FOR$", "html",
                        (type, uid) -> Optional.of(LEADS)).hasErrors())
                .isFalse();
    }

    @Test
    void aReferenceEditorLoopIsCheckedOnSaveWhenTheEditorDeclaresItsDataset() {
        ContentDefinition restricted = new CdlCompiler().compile("""
                content {
                  editor reference members { label "Members" assetTypes [RECORD_SET] dataset "team" }
                  editor reference anything { label "Any set" assetTypes [RECORD_SET] }
                }
                """).definition();

        OctlResult result = compile(
                "$CMS_FOR(m : members, where=\"m.nope == 1\")$x$CMS_END_FOR$"
                        + "$CMS_FOR(m : anything, where=\"m.nope == 1\")$x$CMS_END_FOR$"
                        + "$CMS_FOR(m : members, sort=\"name\", limit=2)$x$CMS_END_FOR$",
                restricted);

        // Only the restricted editor's loop is checked; the other one is checked when it renders.
        assertThat(result.diagnostics()).filteredOn(d -> d.severity() == Severity.ERROR)
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD);
    }

    @Test
    void aRecordSetHasNoUrl() {
        assertThat(codes(compile("$CMS_REF(recordset:leads)$"))).containsExactly(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
    }

    @Test
    void theDatasetLoopQueriesOfATemplateDoNotIncludeSetLoopsOfTheSameUid() {
        OctlResult result = compiler.compile(
                "$CMS_FOR(m : recordset:team)$x$CMS_END_FOR$$CMS_FOR(m : dataset:team, limit=1)$x$CMS_END_FOR$",
                "html",
                (type, uid) -> Optional.of(TEAM));

        assertThat(result.template().datasetQueries("team")).singleElement().satisfies(q -> assertThat(q.limit()).isEqualTo(1));
    }

    /** M25.2.3: what incremental planning reads off a template — found by the uid as spelled, without a resolver. */
    @Test
    void theReadsOfARecordSetAreListedByUid() {
        CompiledTemplate loops = compiler.compile(
                        "$CMS_FOR(m : recordset:leads, where=\"m.role == 'lead'\")$x$CMS_END_FOR$"
                                + "$CMS_FOR(m : recordset:loop)$$CMS_FOR(n : recordset:leads, limit=2)$y$CMS_END_FOR$$CMS_END_FOR$",
                        "html",
                        null)
                .template();
        RecordSetReads leads = loops.recordSetReads("leads");
        assertThat(leads.valueReads()).isFalse();
        assertThat(leads.loops()).hasSize(2).anySatisfy(q -> assertThat(q.where()).isNotNull())
                .anySatisfy(q -> assertThat(q.limit()).isEqualTo(2));
        assertThat(loops.recordSetReads("loop").loops()).singleElement().satisfies(q -> assertThat(q.where()).isNull());
        assertThat(loops.recordSetReads("nope")).isEqualTo(RecordSetReads.NONE);
        assertThat(loops.recordSetReads("nope").isEmpty()).isTrue();

        // The value form, a path into the root value object and a condition are value reads; a dataset loop of the
        // same uid is not a read of the set.
        CompiledTemplate values = compiler.compile(
                        "$CMS_VALUE(recordset:leads)$$CMS_IF(recordset:loop._count > 0)$z$CMS_END_IF$"
                                + "$CMS_FOR(m : recordset:gone.records)$w$CMS_END_FOR$$CMS_FOR(m : dataset:leads)$v$CMS_END_FOR$",
                        "html",
                        null)
                .template();
        assertThat(values.recordSetReads("leads")).isEqualTo(new RecordSetReads(List.of(), true));
        assertThat(values.recordSetReads("loop").valueReads()).isTrue();
        assertThat(values.recordSetReads("gone")).isEqualTo(new RecordSetReads(List.of(), true));

        // A record template reads sets the same way.
        CompiledTemplate recordTemplate = compiler.compileRecordTemplate(
                        "$CMS_VALUE(featured)$$CMS_FOR(m : recordset:leads)$$CMS_VALUE(m.name)$$CMS_END_FOR$", "html", null, null)
                .template();
        assertThat(recordTemplate.recordSetReads("leads").loops()).hasSize(1);
        assertThat(recordTemplate.recordSetReads("leads").valueReads()).isFalse();
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    @Test
    void aSetWhoseStoredQueryNoLongerValidatesRendersEmptyWithAWarning() {
        Store store = new Store().set(LEADS, "leads", new RecordSetQuery("removed == 'x'", null, null, null),
                record("ada", "Ada", "lead"));

        RenderResult result = store.render(
                "[$CMS_VALUE(recordset:leads)$][$CMS_VALUE(recordset:leads._count)$]"
                        + "[$CMS_FOR(m : recordset:leads)$never$CMS_END_FOR$]");

        assertThat(result.output()).isEqualTo("[][0][]");
        assertThat(result.warnings()).singleElement().satisfies(w -> {
            assertThat(w.code()).isEqualTo(DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID);
            assertThat(w.severity()).isEqualTo(Severity.WARNING);
            assertThat(w.message()).contains("leads").contains("removed");
        });
    }

    @Test
    void aSetWithoutARecordTemplateForTheChannelRendersEmptyWithAWarning() {
        Store store = new Store().set(LEADS, "leads", RecordSetQuery.ALL, record("ada", "Ada", "lead"));
        store.recordTemplate = null;

        RenderResult result = store.render("[$CMS_VALUE(recordset:leads)$]$CMS_VALUE(recordset:leads._count)$");

        assertThat(result.output()).isEqualTo("[]1");
        assertThat(result.warnings()).singleElement().satisfies(w -> {
            assertThat(w.code()).isEqualTo(DiagnosticCodes.GEN_RECORD_TEMPLATE_MISSING);
            assertThat(w.message()).contains("leads").contains("team").contains("'html'");
        });
    }

    @Test
    void aDeletedSetRendersEmptyWithAMissingTargetWarning() {
        Store store = new Store();

        RenderResult result = store.render("[$CMS_VALUE(recordset:gone)$][$CMS_VALUE(recordset:gone._count)$]");

        assertThat(result.output()).isEqualTo("[][]");
        assertThat(result.warnings()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
    }

    @Test
    void theSetAndItsDatasetAreDependenciesAndRecordTemplateDependenciesAreCollected() {
        UUID page = UUID.randomUUID();
        Store store = new Store().set(LEADS, "leads", RecordSetQuery.ALL, record("ada", "Ada", "lead"));
        store.pageUuid = page;
        store.recordTemplate = "$CMS_VALUE(name)$$CMS_VALUE(page:about.title)$";

        RenderResult result = store.render("$CMS_VALUE(recordset:leads)$");

        assertThat(result.dependencies()).contains(LEADS, TEAM, page);
    }

    @Test
    void aReferenceEditorValueRendersTheSetAndIsADependency() throws Exception {
        Store store = new Store().set(LEADS, "leads", RecordSetQuery.ALL, record("ada", "Ada", "lead"), record("bob", "Bob", "dev"));

        RenderResult result = store.render(
                "$CMS_VALUE(featured)$|$CMS_VALUE(featured._count)$|$CMS_FOR(m : featured, where=\"m.role == 'dev'\")$"
                        + "$CMS_VALUE(m.name)$$CMS_END_FOR$",
                MAPPER.readTree("{\"featured\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + LEADS + "\",\"assetType\":\"RECORD_SET\"}}"));

        assertThat(result.output()).isEqualTo("<b>Ada</b><b>Bob</b>|2|Bob");
        assertThat(result.dependencies()).contains(LEADS, TEAM);
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void anUnknownFieldInAnUnrestrictedReferenceLoopWarnsAtRenderTimeAndSkipsRecords() throws Exception {
        Store store = new Store().set(LEADS, "leads", RecordSetQuery.ALL, record("ada", "Ada", "lead"));

        RenderResult result = store.render(
                "$CMS_FOR(m : featured, where=\"m.nope == 'x'\")$never$CMS_END_FOR$"
                        + "$CMS_FOR(m : featured, where=\"m.nope == 'x'\")$never$CMS_END_FOR$",
                MAPPER.readTree("{\"featured\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + LEADS + "\",\"assetType\":\"RECORD_SET\"}}"));

        assertThat(result.output()).isEmpty();
        assertThat(result.warnings()).allSatisfy(w -> {
            assertThat(w.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD);
            assertThat(w.severity()).isEqualTo(Severity.WARNING);
            assertThat(w.message()).contains("nope");
        }).hasSize(2);
    }

    @Test
    void aSetRenderingItselfIsACycleNotAStackOverflow() {
        Store store = new Store().set(LOOP, "loop", RecordSetQuery.ALL, record("ada", "Ada", "lead"));
        store.recordTemplate = "<i>$CMS_VALUE(recordset:loop)$</i>";

        assertThatThrownBy(() -> store.render("$CMS_VALUE(recordset:loop)$"))
                .isInstanceOfSatisfying(RenderLimitException.class, e -> {
                    assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_INCLUDE_CYCLE);
                    assertThat(e.diagnostic().message()).contains("recordset:loop");
                });
    }

    @Test
    void aRecordReferencingItsOwnSetIsACycleToo() throws Exception {
        String loopRef = "{\"type\":\"ASSET_REF\",\"uuid\":\"" + LOOP + "\",\"assetType\":\"RECORD_SET\"}";
        Store store = new Store().set(LOOP, "loop", RecordSetQuery.ALL,
                new RecordView(UUID.randomUUID(), "ada", "Ada", "/", "loop", Instant.EPOCH,
                        MAPPER.readTree("{\"name\":\"Ada\",\"featured\":" + loopRef + "}")));
        store.recordTemplate = "$CMS_VALUE(featured)$";

        assertThatThrownBy(() -> store.render("$CMS_VALUE(recordset:loop)$"))
                .isInstanceOfSatisfying(RenderLimitException.class,
                        e -> assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_INCLUDE_CYCLE));
    }

    @Test
    void theLoopIterationLimitAppliesToSetLoopsAndToTheValueForm() {
        RecordView[] many = new RecordView[RenderBudget.MAX_LOOP_ITERATIONS + 1];
        for (int i = 0; i < many.length; i++) {
            many[i] = new RecordView(new UUID(7, i), "r" + i, "R" + i, "/", "leads", Instant.EPOCH,
                    MAPPER.createObjectNode().put("name", "R" + i));
        }
        Store store = new Store().set(LEADS, "leads", RecordSetQuery.ALL, many);
        store.recordTemplate = "";

        for (String source : List.of("$CMS_VALUE(recordset:leads)$", "$CMS_FOR(m : recordset:leads)$$CMS_END_FOR$")) {
            assertThatThrownBy(() -> store.render(source))
                    .as(source)
                    .isInstanceOfSatisfying(RenderLimitException.class,
                            e -> assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_LOOP_LIMIT));
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private OctlResult compile(String source) {
        return compile(source, null);
    }

    private OctlResult compile(String source, ContentDefinition definition) {
        return compiler.compile(source, "html", saveResolver, definition);
    }

    private static List<String> codes(OctlResult result) {
        return result.diagnostics().stream().map(Diagnostic::code).toList();
    }

    private static RecordView record(String uid, String name, String role) {
        return new RecordView(UUID.nameUUIDFromBytes(uid.getBytes()), uid, name, "/", "leads", Instant.EPOCH,
                MAPPER.createObjectNode().put("name", name).put("role", role));
    }

    /** A stub content store: record sets of dataset {@code team} and its html record template. */
    private final class Store {
        private final Map<UUID, RecordSetSource> sets = new HashMap<>();
        private String recordTemplate = "<b>$CMS_VALUE(name)$</b>";
        private UUID pageUuid;

        Store set(UUID uuid, String uid, RecordSetQuery query, RecordView... records) {
            sets.put(uuid, new RecordSetSource(uuid, uid, uid, TEAM, "team", RecordSetQueries.compile(query, TEAM_SCHEMA),
                    TEAM_SCHEMA, new ArrayList<>(List.of(records))));
            return this;
        }

        RenderResult render(String source) {
            return render(source, MAPPER.createObjectNode());
        }

        RenderResult render(String source, JsonNode values) {
            ReferenceResolver references = (type, uid) -> "page".equals(type) && pageUuid != null
                    ? Optional.of(pageUuid)
                    : saveResolver.resolve(type, uid);
            OctlResult page = compiler.compile(source, "html", references);
            assertThat(page.hasErrors()).as("%s", page.diagnostics()).isFalse();
            CompiledTemplate compiledRecordTemplate = recordTemplate == null
                    ? null
                    : compiler.compileRecordTemplate(recordTemplate, "html", references, TEAM_SCHEMA).template();
            RenderContext context = RenderContext.builder()
                    .values(values)
                    .assetValueResolver(new AssetValueResolver() {
                        @Override
                        public JsonNode valueOf(String assetType, UUID uuid) {
                            return uuid.equals(pageUuid) ? MAPPER.createObjectNode().put("title", "!") : MissingNode.getInstance();
                        }

                        @Override
                        public RecordSetSource recordSet(UUID setUuid) {
                            return sets.get(setUuid);
                        }
                    })
                    .blockResolver(new BlockResolver() {
                        @Override
                        public String renderBody(String bodyName) {
                            return "";
                        }

                        @Override
                        public String renderInclude(String uid, Map<String, String> args) {
                            return "";
                        }

                        @Override
                        public CompiledTemplate recordTemplate(UUID datasetUuid) {
                            return TEAM.equals(datasetUuid) ? compiledRecordTemplate : null;
                        }
                    })
                    .build();
            return renderer.render(page.template(), context);
        }
    }
}
