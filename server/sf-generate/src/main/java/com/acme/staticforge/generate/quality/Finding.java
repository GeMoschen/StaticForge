package com.acme.staticforge.generate.quality;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Objects;

/**
 * What a quality rule found on one output (M30.1.1). Rules create findings through their {@link RuleContext}, which
 * fills in everything but the message.
 *
 * @param output the output the finding is on
 * @param code the rule's code ({@code SF-CHK-0xyz})
 * @param category the rule's category
 * @param severity the effective severity when the finding was made: {@code WARNING} or {@code ERROR}
 * @param message what is wrong, naming the element or the target
 * @param selector a stable CSS selector of the element ({@link Selectors}); {@code null} for a finding about the whole
 *     output (a missing {@code <title>}, a duplicate title)
 * @param sectionInstanceId the section instance the element was rendered by, when the document carries section
 *     markers ({@link SectionMarkers}, draft checks only); else {@code null}
 * @param carried the finding was taken from the base build's sidecar for an output carried forward (M30.1.3)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Finding(
        OutputKey output,
        String code,
        QualityCategory category,
        QualitySeverity severity,
        String message,
        String selector,
        String sectionInstanceId,
        boolean carried) {

    public Finding {
        Objects.requireNonNull(output, "output");
        Objects.requireNonNull(code, "code");
        Objects.requireNonNull(category, "category");
        Objects.requireNonNull(severity, "severity");
        if (severity == QualitySeverity.OFF) {
            throw new IllegalArgumentException("A finding is a WARNING or an ERROR: " + code);
        }
        message = message == null ? "" : message;
    }

    /** Whether the finding holds its page back (only a finding on an output this run rendered does). */
    @JsonIgnore
    public boolean isError() {
        return severity == QualitySeverity.ERROR;
    }

    /** The same finding with another severity (a carried finding re-severitied under the current configuration). */
    public Finding withSeverity(QualitySeverity newSeverity) {
        return new Finding(output, code, category, newSeverity, message, selector, sectionInstanceId, carried);
    }

    /** The same finding on {@code newOutput}, marked as carried from the base build. */
    public Finding carriedTo(OutputKey newOutput) {
        return new Finding(newOutput, code, category, severity, message, selector, sectionInstanceId, true);
    }
}
