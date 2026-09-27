package com.acme.staticforge.revision.compaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetVersion;
import com.tngtech.archunit.core.domain.JavaAccess;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaFieldAccess;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import jakarta.persistence.Column;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Revision compaction is the only code path that rewrites history (M29.4.2): only {@link RevisionCompactor} may
 * decrease a {@code valid_from_revision}. Three guards make another writer fail the build:
 *
 * <ul>
 *   <li>the JPA mappings of {@code asset_version.valid_from_revision} and {@code asset_reference.valid_from_revision}
 *       are not updatable and have no setter, so no entity save can move them;
 *   <li>no class assigns those fields outside the entity's own constructors (ArchUnit);
 *   <li>no SQL or JPQL in any server module's main sources updates them, except in {@code RevisionCompactor}.
 * </ul>
 */
class RevisionHistoryRewriteGuardTest {

    private static final Set<Class<?>> VERSIONED = Set.of(AssetVersion.class, AssetReference.class);

    private static final String ALLOWED_SOURCE = "RevisionCompactor.java";

    /**
     * {@code UPDATE asset_version|AssetVersion|asset_reference|AssetReference … SET …} up to the next {@code WHERE} (or
     * the statement's end), with string concatenations joined first.
     */
    private static final Pattern UPDATE = Pattern.compile(
            "(?is)\\bupdate\\s+(asset_version|assetversion|asset_reference|assetreference)\\b(.{0,600}?)(\\bwhere\\b|;)");

    private static final Pattern VALID_FROM = Pattern.compile("(?i)\\bvalid_?from_?revision\\s*=");

    @Test
    @DisplayName("valid_from_revision is not updatable through JPA and has no setter")
    void mappingsCantMoveTheStart() throws NoSuchFieldException {
        for (Class<?> type : VERSIONED) {
            Column column = type.getDeclaredField("validFromRevision").getAnnotation(Column.class);
            assertThat(column.updatable()).as("%s.validFromRevision updatable", type.getSimpleName()).isFalse();
            assertThat(Arrays.stream(type.getMethods()).map(Method::getName))
                    .as("%s setters", type.getSimpleName())
                    .doesNotContain("setValidFromRevision");
        }
    }

    @Test
    @DisplayName("no class assigns validFromRevision outside the entity's constructors")
    void onlyConstructorsAssignTheStart() {
        JavaClasses classes = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.acme.staticforge");
        List<String> violations = new ArrayList<>();
        for (JavaClass javaClass : classes) {
            for (JavaFieldAccess access : javaClass.getFieldAccessesFromSelf()) {
                if (access.getAccessType() != JavaFieldAccess.AccessType.SET
                        || !access.getTarget().getName().equals("validFromRevision")
                        || VERSIONED.stream().noneMatch(type -> access.getTargetOwner().isEquivalentTo(type))) {
                    continue;
                }
                boolean ownConstructor = access.getOrigin().isConstructor()
                        && access.getOriginOwner().isEquivalentTo(access.getTargetOwner().reflect());
                if (!ownConstructor) {
                    violations.add(describe(access));
                }
            }
        }
        assertThat(violations).as("assignments of validFromRevision outside the constructors").isEmpty();
    }

    @Test
    @DisplayName("only RevisionCompactor updates valid_from_revision in SQL or JPQL")
    void onlyTheCompactorRewritesTheStart() throws IOException {
        Path server = Path.of("").toAbsolutePath().getParent();
        TreeMap<String, List<String>> writers = new TreeMap<>();
        try (Stream<Path> files = Files.walk(server)) {
            files.filter(file -> file.toString().endsWith(".java"))
                    .filter(file -> file.toString().replace('\\', '/').contains("/src/main/java/"))
                    .forEach(file -> {
                        List<String> statements = updatesOfValidFrom(read(file));
                        if (!statements.isEmpty()) {
                            writers.put(file.getFileName().toString(), statements);
                        }
                    });
        }
        assertThat(writers).as("sources updating valid_from_revision").containsOnlyKeys(ALLOWED_SOURCE);
        // The scan itself works: it sees the compactor's own statements (versions and references).
        assertThat(writers.get(ALLOWED_SOURCE)).hasSize(2);
    }

    @Test
    @DisplayName("the source scan recognizes the usual shapes of such an update")
    void scanRecognizesUpdates() {
        assertThat(updatesOfValidFrom("jdbc.update(\"UPDATE asset_version SET valid_from_revision = ? WHERE id = ?\")"))
                .hasSize(1);
        assertThat(updatesOfValidFrom("\"UPDATE asset_reference SET valid_to_revision = ?, \" + \"valid_from_revision = ? "
                + "WHERE id = ?\"")).hasSize(1);
        assertThat(updatesOfValidFrom("@Query(\"update AssetVersion v set v.validFromRevision = :r where v.id = :id\")"))
                .hasSize(1);
        assertThat(updatesOfValidFrom("\"UPDATE asset_version SET valid_to_revision = ? WHERE valid_from_revision = ?\""))
                .isEmpty();
        assertThat(updatesOfValidFrom("\"UPDATE asset_release SET valid_from_revision = ?\"")).isEmpty();
    }

    /** The update statements in {@code source} that assign {@code valid_from_revision}. */
    static List<String> updatesOfValidFrom(String source) {
        String joined = source.replaceAll("\"\\s*\\+\\s*\"", "").replaceAll("\\s+", " ");
        List<String> out = new ArrayList<>();
        Matcher matcher = UPDATE.matcher(joined);
        while (matcher.find()) {
            if (VALID_FROM.matcher(matcher.group(2)).find()) {
                out.add(matcher.group());
            }
        }
        return out;
    }

    private static String read(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String describe(JavaAccess<?> access) {
        return access.getOriginOwner().getName() + "." + access.getOrigin().getName() + " (line " + access.getLineNumber()
                + ")";
    }
}
