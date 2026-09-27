package com.acme.staticforge.generate.quality;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * A build's {@code quality.json} sidecar (M30, epic decision 7), stored next to its manifest and pruned with it: per
 * checked HTML output its {@link HtmlFacts} and its page-local findings, plus the fingerprint of the rule configuration
 * it was checked under. An incremental or scoped run takes carried outputs' facts and findings from its base build's
 * sidecar instead of parsing bytes it never rendered.
 *
 * @param configFingerprint {@link EffectiveQualityConfig#fingerprint()} of the configuration the build was checked
 *     under; a different one plans the next incremental request FULL ({@code QUALITY_RULES_CHANGED})
 * @param outputs by output path, every checked HTML output the build publishes
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record QualitySidecar(int version, String configFingerprint, Map<String, Entry> outputs) {

    /** The sidecar's name: {@code builds/{runId}.quality.json}. */
    public static final String NAME = "quality";

    public static final int VERSION = 1;

    private static final ObjectMapper JSON = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .setSerializationInclusion(JsonInclude.Include.NON_NULL);

    public QualitySidecar {
        outputs = outputs == null ? Map.of() : new TreeMap<>(outputs);
    }

    /**
     * One output's facts, page-local findings and the references the renderer could not resolve in it.
     *
     * @param facts {@code null} when the output couldn't be parsed
     * @param references the renderer's reference events of the output (M30.2.1): a carried output still reports its
     *     links to unreleased, deleted and missing assets, which its bytes no longer show
     */
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record Entry(HtmlFacts facts, List<PageFinding> findings, List<ReferenceEvent> references) {

        @JsonCreator
        public Entry {
            findings = findings == null ? List.of() : List.copyOf(findings);
            references = references == null ? List.of() : List.copyOf(references);
        }

        /** An entry of an output without unresolved references. */
        public Entry(HtmlFacts facts, List<PageFinding> findings) {
            this(facts, findings, List.of());
        }
    }

    /** A page-local finding without its output (the entry's key names it). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PageFinding(
            String code,
            QualityCategory category,
            QualitySeverity severity,
            String message,
            String selector,
            String sectionInstanceId) {

        public static PageFinding of(Finding finding) {
            return new PageFinding(finding.code(), finding.category(), finding.severity(), finding.message(),
                    finding.selector(), finding.sectionInstanceId());
        }

        /** The finding on {@code output}, carried from the base build. */
        public Finding toFinding(OutputKey output) {
            return new Finding(output, code, category, severity, message, selector, sectionInstanceId, true);
        }
    }

    public Optional<Entry> entry(String path) {
        return Optional.ofNullable(outputs.get(path));
    }

    public byte[] toJson() {
        try {
            return JSON.writeValueAsBytes(this);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize the quality sidecar", e);
        }
    }

    /** The sidecar in {@code bytes}; empty when it can't be read or was written by an incompatible version. */
    public static Optional<QualitySidecar> parse(byte[] bytes) {
        try {
            QualitySidecar sidecar = JSON.readValue(bytes, QualitySidecar.class);
            return sidecar.version() == VERSION ? Optional.of(sidecar) : Optional.empty();
        } catch (IOException | RuntimeException e) {
            return Optional.empty();
        }
    }
}
