package com.acme.staticforge.template.octl;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link CompiledTemplate#referenceUses()}: the instruction kind reported for every reference position (spec §16.4). */
class OctlCompilerReferenceUseTest {

    private final OctlCompiler compiler = new OctlCompiler();

    /** Resolves every reference except uid {@code nope}. */
    private static final ReferenceResolver RESOLVER = (type, uid) -> "nope".equals(uid)
            ? Optional.empty()
            : Optional.of(UUID.nameUUIDFromBytes((type + ":" + uid).getBytes()));

    @Test
    void valueRefAndIncludeInstructions() {
        assertThat(uses("$CMS_VALUE(page:about.headline)$")).isEqualTo(Map.of("page:about", Set.of(ReferenceUse.VALUE)));
        assertThat(uses("$CMS_REF(page:about)$")).isEqualTo(Map.of("page:about", Set.of(ReferenceUse.REF)));
        assertThat(uses("$CMS_INCLUDE(section_template:teaser)$"))
                .isEqualTo(Map.of("section_template:teaser", Set.of(ReferenceUse.INCLUDE)));
    }

    @Test
    void navigationAndNavForSourcesAreRefs() {
        assertThat(uses("$CMS_NAVIGATION(nav:main)$")).isEqualTo(Map.of("nav:main", Set.of(ReferenceUse.REF)));
        assertThat(uses("$CMS_FOR(item : nav:main)$$CMS_VALUE(item.label)$$CMS_END_FOR$"))
                .isEqualTo(Map.of("nav:main", Set.of(ReferenceUse.REF)));
    }

    @Test
    void assetAccessorsInConditionsSetsAndForSourcesAreValues() {
        assertThat(uses("$CMS_IF(page:about.show)$x$CMS_END_IF$"))
                .isEqualTo(Map.of("page:about", Set.of(ReferenceUse.VALUE)));
        assertThat(uses("$CMS_IF(!(page:a.x) && page:b.y | size > 0)$x$CMS_ELSE$$CMS_REF(page:c)$$CMS_END_IF$"))
                .isEqualTo(Map.of(
                        "page:a", Set.of(ReferenceUse.VALUE),
                        "page:b", Set.of(ReferenceUse.VALUE),
                        "page:c", Set.of(ReferenceUse.REF)));
        assertThat(uses("$CMS_SET(title = page:about.headline)$"))
                .isEqualTo(Map.of("page:about", Set.of(ReferenceUse.VALUE)));
        assertThat(uses("$CMS_FOR(item : page:about.items)$$CMS_VALUE(item)$$CMS_END_FOR$"))
                .isEqualTo(Map.of("page:about", Set.of(ReferenceUse.VALUE)));
    }

    @Test
    void referencesNestedInBlocksAreFoundAndMultipleUsesAreKept() {
        String source = "$CMS_FOR(item : nav:main)$"
                + "$CMS_IF(item._first)$$CMS_INCLUDE(section_template:teaser)$$CMS_END_IF$"
                + "$CMS_END_FOR$"
                + "$CMS_REF(page:about)$ $CMS_VALUE(page:about.headline)$";

        assertThat(uses(source)).isEqualTo(Map.of(
                "nav:main", Set.of(ReferenceUse.REF),
                "section_template:teaser", Set.of(ReferenceUse.INCLUDE),
                "page:about", Set.of(ReferenceUse.REF, ReferenceUse.VALUE)));
    }

    @Test
    void usesCoverExactlyTheResolvedReferences() {
        CompiledTemplate template = compiler.compile(
                "$CMS_REF(page:about)$$CMS_REF(page:nope)$$CMS_VALUE(headline)$", "html", RESOLVER).template();

        assertThat(template.referenceUses().keySet()).isEqualTo(template.references().keySet());
        assertThat(template.referenceUses()).containsOnlyKeys("page:about");
        assertThat(compiler.compile("$CMS_REF(page:about)$", "html", null).template().referenceUses()).isEmpty();
    }

    private Map<String, Set<ReferenceUse>> uses(String source) {
        return compiler.compile(source, "html", RESOLVER).template().referenceUses();
    }
}
