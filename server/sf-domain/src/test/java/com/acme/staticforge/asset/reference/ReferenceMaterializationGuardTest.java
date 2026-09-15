package com.acme.staticforge.asset.reference;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.media.MediaServiceImpl;
import com.acme.staticforge.asset.media.MediaVersionRepository;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Guards spec §5.4's "references follow version writes" rule (M16.3.1): every class that saves
 * an {@code asset_version} row must also sync reference rows through {@link ReferenceMaterializer},
 * so a new write path cannot silently leave {@code asset_reference} stale.
 */
class ReferenceMaterializationGuardTest {

    /**
     * Writers that save a version row without writing a new version: {@code MediaServiceImpl}
     * only sets the {@code mime_type}/{@code size_bytes} projections on the open version created
     * a moment earlier through {@code AssetService.create}, which already materialized its edges.
     */
    private static final Set<Class<?>> ALLOWED = Set.of(MediaServiceImpl.class);

    private static final JavaClasses DOMAIN = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.acme.staticforge");

    @Test
    void versionWritersMaterializeReferences() {
        classes()
                .that(saveVersionRows())
                .and(DescribedPredicate.not(allowListed()))
                .should()
                .dependOnClassesThat()
                .areAssignableTo(ReferenceMaterializer.class)
                .because("every asset_version write must sync its asset_reference rows in the same revision")
                .check(DOMAIN);
    }

    private static DescribedPredicate<JavaClass> saveVersionRows() {
        return DescribedPredicate.describe("save asset_version rows", javaClass -> javaClass.getMethodCallsFromSelf()
                .stream()
                .anyMatch(call -> call.getName().startsWith("save")
                        && (call.getTargetOwner().isAssignableTo(AssetVersionRepository.class)
                                || call.getTargetOwner().isAssignableTo(MediaVersionRepository.class))));
    }

    private static DescribedPredicate<JavaClass> allowListed() {
        return DescribedPredicate.describe("allow-listed", javaClass -> ALLOWED.stream()
                .anyMatch(allowed -> javaClass.isEquivalentTo(allowed)));
    }
}
