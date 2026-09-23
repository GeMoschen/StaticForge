package com.acme.staticforge.asset.template;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.octl.ReferenceResolver;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** `M16.1.1`: correctness of both compile tiers, observed through the compile counter. */
class CompiledTemplateCacheTest {

    private static final String CDL = "content { editor text headline { label \"Headline\" } }";
    private static final String OCTL = "$CMS_VALUE(headline)$ $CMS_REF(page:about)$";
    private static final UUID TEMPLATE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID ABOUT = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("20000000-0000-0000-0000-000000000002");

    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final CompiledTemplateCache cache = new CompiledTemplateCache(meters, 2000, Duration.ofMinutes(30));
    private final Map<String, UUID> project = new HashMap<>(Map.of("page:about", ABOUT));
    private final ReferenceResolver resolver = (type, uid) -> Optional.ofNullable(project.get(type + ":" + uid));

    @Test
    void sameVersionIsCompiledOnceAcrossRequests() {
        CompiledChannel first = cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);
        CompiledChannel second = cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        assertThat(second).isSameAs(first);
        assertThat(first.template().references()).containsEntry("page:about", ABOUT);
        assertThat(compiles("octl")).isEqualTo(1);
        assertThat(compiles("cdl")).isEqualTo(1);
    }

    @Test
    void newTemplateVersionAndOtherChannelCompileSeparately() {
        cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);
        cache.compile(1L, TEMPLATE, 6L, "html", CDL, "changed", resolver);
        cache.compile(1L, TEMPLATE, 6L, "markdown", CDL, "md", resolver);

        assertThat(compiles("octl")).isEqualTo(3);
        assertThat(compiles("cdl")).isEqualTo(2);
        // The older version (time travel) is still its own entry, never the newer one.
        assertThat(cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver).template().nodes()).hasSizeGreaterThan(1);
        assertThat(compiles("octl")).isEqualTo(3);
    }

    @Test
    void changedReferenceTargetForcesRecompile() {
        cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        project.put("page:about", OTHER); // uid "about" now names another asset
        CompiledChannel recompiled = cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        assertThat(recompiled.template().references()).containsEntry("page:about", OTHER);
        assertThat(compiles("octl")).isEqualTo(2);
        assertThat(compiles("cdl")).as("the definition does not depend on references").isEqualTo(1);
    }

    @Test
    void renamedAwayReferenceIsNeverServedStale() {
        cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        project.remove("page:about");
        CompiledChannel recompiled = cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        assertThat(recompiled.template().references()).doesNotContainKey("page:about");
        assertThat(recompiled.octl().hasErrors()).isTrue();
    }

    @Test
    void previouslyUnresolvableReferenceThatNowResolvesForcesRecompile() {
        project.remove("page:about");
        cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        project.put("page:about", ABOUT);
        CompiledChannel recompiled = cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);

        assertThat(recompiled.template().references()).containsEntry("page:about", ABOUT);
        assertThat(compiles("octl")).isEqualTo(2);
    }

    @Test
    void projectsNeverShareEntries() {
        cache.compile(1L, TEMPLATE, 5L, "html", CDL, OCTL, resolver);
        cache.compile(2L, TEMPLATE, 5L, "html", CDL, OCTL, (type, uid) -> Optional.of(OTHER));

        assertThat(compiles("octl")).isEqualTo(2);
        assertThat(compiles("cdl")).isEqualTo(2);
    }

    @Test
    void buildMemoIsSharedPerBuildObjectAndCompilesEachChannelOnce() {
        Object build = new Object();
        TemplateCompileMemo memo = cache.buildMemo(build);
        assertThat(cache.buildMemo(build)).isSameAs(memo);
        assertThat(cache.buildMemo(new Object())).isNotSameAs(memo);

        for (int i = 0; i < 10; i++) {
            memo.compile(TEMPLATE, "html", CDL, OCTL, resolver);
            memo.compile(TEMPLATE, "markdown", CDL, "md", resolver);
        }

        assertThat(compiles("octl")).isEqualTo(2);
        assertThat(compiles("cdl")).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Dataset record templates (M25.2.1)
    // ------------------------------------------------------------------

    private static final UUID DATASET = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final String RECORD_OCTL = "$CMS_VALUE(headline)$ $CMS_VALUE(_index)$ $CMS_REF(page:about)$";

    @Test
    void aRecordTemplateCompilesOncePerDatasetVersionAndChannelWithTheRecordScope() {
        CompiledChannel first = cache.compileRecordTemplate(1L, DATASET, 7L, "html", CDL, RECORD_OCTL, resolver);
        CompiledChannel second = cache.compileRecordTemplate(1L, DATASET, 7L, "html", CDL, RECORD_OCTL, resolver);
        cache.compileRecordTemplate(1L, DATASET, 7L, "md", CDL, RECORD_OCTL, resolver);

        assertThat(second).isSameAs(first);
        assertThat(first.octl().diagnostics()).as("_index is in a record template's scope").isEmpty();
        assertThat(first.definition().findEditor("headline")).isPresent();
        assertThat(compiles("octl")).isEqualTo(2);
        assertThat(compiles("cdl")).isEqualTo(1);
    }

    @Test
    void aRecordTemplateIsRevalidatedAgainstReferencesLikeATemplate() {
        cache.compileRecordTemplate(1L, DATASET, 7L, "html", CDL, RECORD_OCTL, resolver);

        project.put("page:about", OTHER);
        CompiledChannel recompiled = cache.compileRecordTemplate(1L, DATASET, 7L, "html", CDL, RECORD_OCTL, resolver);

        assertThat(recompiled.template().references()).containsEntry("page:about", OTHER);
        assertThat(compiles("octl")).isEqualTo(2);
    }

    @Test
    void theBuildMemoCompilesARecordTemplateOncePerBuild() {
        TemplateCompileMemo memo = cache.buildMemo(new Object());

        for (int i = 0; i < 10; i++) {
            memo.compileRecordTemplate(DATASET, "html", CDL, RECORD_OCTL, resolver);
        }
        CompiledChannel compiled = memo.compileRecordTemplate(DATASET, "html", CDL, RECORD_OCTL, resolver);

        assertThat(compiled.octl().diagnostics()).isEmpty();
        assertThat(memo.definition(DATASET, CDL)).isSameAs(compiled.definition());
        assertThat(compiles("octl")).isEqualTo(1);
        assertThat(compiles("cdl")).isEqualTo(1);
    }

    private double compiles(String kind) {
        return meters.get(MeteredTemplateCompiler.COMPILES_METRIC).tag("kind", kind).counter().count();
    }
}
