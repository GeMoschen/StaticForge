package com.acme.staticforge.generate;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.acme.staticforge.template.query.DatasetQueryEvaluator;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Guards M25.1.2's "one evaluator" rule: a record set selects the same records in preview, generation, the
 * record grid and the incremental planner because all of them evaluate set queries through
 * {@link RecordSetQueries} — never by calling {@link DatasetQueryEvaluator} themselves. Every direct caller
 * of the dataset evaluator outside {@code template.query} is listed here with the reason it is not about
 * record sets; a new caller (a planner rule) fails this test until it goes through {@code RecordSetQueries}.
 * Set rendering (M25.2.2) goes through it.
 *
 * <p>Imports the modules generation sees ({@code sf-template}, {@code sf-domain}, {@code sf-generate}),
 * which is every module that renders, lists or plans records.
 */
class RecordSetQueryEvaluatorGuardTest {

    /** Direct callers of the dataset evaluator, none of which evaluates a record set's stored query. */
    private static final Set<String> DATASET_QUERY_CALLERS = Set.of(
            // $CMS_FOR(x : dataset:uid, …) loops (M19.3.2): all records of a dataset, no set query (decision 6).
            "com.acme.staticforge.template.render.OctlRenderer",
            // GET /datasets/{uuid}/records: the dataset-wide grid across sets (M19.2.1).
            "com.acme.staticforge.asset.dataset.RecordServiceImpl",
            // Paginated dataset sources sort all records of a dataset (M21).
            "com.acme.staticforge.pagination.PaginationSource",
            // Incremental planning of dataset: loops (M19.3.2).
            "com.acme.staticforge.generate.plan.DatasetLoopImpact");

    private static final JavaClasses CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.acme.staticforge");

    @Test
    void recordSetQueriesAreTheOnlyNewWayIntoTheDatasetEvaluator() {
        noClasses()
                .that()
                .resideOutsideOfPackage("com.acme.staticforge.template.query")
                .and(DescribedPredicate.not(knownDatasetQueryCaller()))
                .should()
                .callMethodWhere(DescribedPredicate.describe(
                        "the target is DatasetQueryEvaluator",
                        call -> call.getTargetOwner().isEquivalentTo(DatasetQueryEvaluator.class)))
                .because("record set queries are evaluated only through RecordSetQueries (M25.1.2)")
                .check(CLASSES);
    }

    @Test
    void theRecordGridAndThePreviewUseTheSharedEvaluator() {
        classes()
                .that()
                .haveFullyQualifiedName("com.acme.staticforge.asset.dataset.RecordSetServiceImpl")
                .should()
                .dependOnClassesThat()
                .areAssignableTo(RecordSetQueries.class)
                .check(CLASSES);
    }

    /**
     * M25.2.2: rendering a set selects through the shared evaluator — the renderer (value form, loops, root value
     * object) and both pipelines' set sources, which compile the stored query with it.
     */
    @Test
    void setRenderingAndBothPipelinesUseTheSharedEvaluator() {
        classes()
                .that()
                .haveFullyQualifiedName("com.acme.staticforge.template.render.OctlRenderer")
                .or()
                .haveFullyQualifiedName("com.acme.staticforge.generate.render.SnapshotAssetValueResolver")
                .or()
                .haveFullyQualifiedName("com.acme.staticforge.preview.LiveAssetValueResolver")
                .should()
                .dependOnClassesThat()
                .areAssignableTo(RecordSetQueries.class)
                .check(CLASSES);
    }

    private static DescribedPredicate<JavaClass> knownDatasetQueryCaller() {
        return DescribedPredicate.describe("a known dataset query caller", javaClass -> DATASET_QUERY_CALLERS.stream()
                .anyMatch(name -> javaClass.getName().equals(name) || javaClass.getName().startsWith(name + "$")));
    }
}
