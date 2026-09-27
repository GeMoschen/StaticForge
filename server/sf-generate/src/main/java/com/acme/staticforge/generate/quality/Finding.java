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
 * @param editorPath the field of the rendering page's content that holds what the finding is about
 *     ({@code content.cta}, {@code bodies.main[0].content.image}), when known — a reference the renderer could not
 *     resolve ({@link ReferenceEvent#editorPath()}), or in a draft check (M30.3.1) the media editor of an image;
 *     {@code null} otherwise. Not stored with a run's findings: the message names the field.
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
        boolean carried,
        String editorPath) {

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

    /** A finding whose field in the content isn't known. */
    public Finding(
            OutputKey output,
            String code,
            QualityCategory category,
            QualitySeverity severity,
            String message,
            String selector,
            String sectionInstanceId,
            boolean carried) {
        this(output, code, category, severity, message, selector, sectionInstanceId, carried, null);
    }

    /** Whether the finding holds its page back (only a finding on an output this run rendered does). */
    @JsonIgnore
    public boolean isError() {
        return severity == QualitySeverity.ERROR;
    }

    /** The same finding with another severity (a carried finding re-severitied under the current configuration). */
    public Finding withSeverity(QualitySeverity newSeverity) {
        return new Finding(output, code, category, newSeverity, message, selector, sectionInstanceId, carried, editorPath);
    }

    /** The same finding on {@code newOutput}, marked as carried from the base build. */
    public Finding carriedTo(OutputKey newOutput) {
        return new Finding(newOutput, code, category, severity, message, selector, sectionInstanceId, true, editorPath);
    }

    /** The same finding in section instance {@code instanceId} (a draft check locating a site rule's finding). */
    public Finding inSection(String instanceId) {
        return new Finding(output, code, category, severity, message, selector, instanceId, carried, editorPath);
    }

    /** The same finding, located at field {@code path} of the rendering page's content. */
    public Finding withEditorPath(String path) {
        return new Finding(output, code, category, severity, message, selector, sectionInstanceId, carried, path);
    }
}
