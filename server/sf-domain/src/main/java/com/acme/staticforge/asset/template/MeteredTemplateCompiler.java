package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.ChainCompileMemo;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.UUID;

/**
 * The CDL and OCTL compilers behind the render-time compile tiers, counting every real compile in
 * {@value #COMPILES_METRIC} (tag {@code kind} = {@code cdl} | {@code octl}) so tests and operators
 * can see how often the caches miss.
 */
final class MeteredTemplateCompiler {

    static final String COMPILES_METRIC = "sf.template.compiles";

    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final OctlCompiler octlCompiler = new OctlCompiler();
    private final Counter cdlCompiles;
    private final Counter octlCompiles;

    MeteredTemplateCompiler(MeterRegistry meterRegistry) {
        this.cdlCompiles = Counter.builder(COMPILES_METRIC).tag("kind", "cdl").register(meterRegistry);
        this.octlCompiles = Counter.builder(COMPILES_METRIC).tag("kind", "octl").register(meterRegistry);
    }

    /** Compiles CDL source; like every render path, a definition with errors is used best-effort. */
    ContentDefinition definition(String cdlSource) {
        cdlCompiles.increment();
        return cdlCompiler.compile(cdlSource == null ? "" : cdlSource).definition();
    }

    OctlResult channel(String octlSource, String channel, ReferenceResolver resolver, ContentDefinition definition) {
        octlCompiles.increment();
        return octlCompiler.compile(octlSource, channel, resolver, definition);
    }

    /** Compiles a dataset's record template against its schema (M25); counted as an {@code octl} compile. */
    OctlResult recordTemplate(String octlSource, String channel, ReferenceResolver resolver, ContentDefinition definition) {
        octlCompiles.increment();
        return octlCompiler.compileRecordTemplate(octlSource, channel, resolver, definition);
    }

    /**
     * Compiles a page template channel against its chain in {@code hierarchy} (M20); counted as one {@code octl}
     * compile, however many ancestors it links.
     */
    OctlResult chain(
            TemplateHierarchy hierarchy,
            UUID templateUuid,
            String templateUid,
            String octlSource,
            String channel,
            ReferenceResolver resolver,
            ContentDefinition definition,
            UUID declaredParent,
            ChainCompileMemo memo) {
        octlCompiles.increment();
        return hierarchy.compile(
                octlCompiler, resolver, templateUuid, templateUid, channel, octlSource, definition, declaredParent, memo);
    }

    /** Compiles a processed text media source (M18); counted as an {@code octl} compile. */
    OctlResult textMedia(String source, String channel, ReferenceResolver resolver, boolean scriptLike) {
        octlCompiles.increment();
        return octlCompiler.compileTextMedia(source, channel, resolver, scriptLike);
    }
}
