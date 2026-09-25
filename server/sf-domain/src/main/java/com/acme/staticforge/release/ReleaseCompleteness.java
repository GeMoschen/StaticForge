package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.dataset.RecordDatasets;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The completeness gate of a release (M27.1.2, epic decision 10): the {@code ERROR}-severity completeness findings
 * (§10.5) of the version about to be released, validated against the <em>current</em> content definition — the same
 * one a build would validate it with. Pages validate against their template, records against their dataset schema
 * and global sets against their own schema; other types carry no editor content and are always complete.
 */
@Component
public class ReleaseCompleteness {

    private static final String CONTENT_PATH = "content";

    private final PageContentValidation pageContentValidation;
    private final RecordDatasets recordDatasets;
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public ReleaseCompleteness(PageContentValidation pageContentValidation, RecordDatasets recordDatasets) {
        this.pageContentValidation = pageContentValidation;
        this.recordDatasets = recordDatasets;
    }

    /** The blocking findings of {@code version} of an asset of {@code type}; empty when it may be released. */
    public List<ContentIssue> blockingIssues(long projectId, AssetType type, AssetVersion version) {
        JsonNode payload = version.getPayload();
        List<ContentIssue> issues = switch (type) {
            case PAGE -> pageContentValidation.issues(projectId, payload);
            case RECORD -> recordIssues(projectId, payload);
            case GLOBAL_SET -> recordDatasets.validator(projectId).validate(
                    cdlCompiler.compile(payload.path("contentDefinition").asText("")).definition(),
                    payload.path("content"),
                    null,
                    CONTENT_PATH);
            default -> List.of();
        };
        return issues.stream()
                .filter(issue -> issue.kind() == ContentIssue.Kind.COMPLETENESS)
                .filter(issue -> issue.severity() == Severity.ERROR)
                .toList();
    }

    private List<ContentIssue> recordIssues(long projectId, JsonNode payload) {
        UUID dataset = datasetRef(payload);
        if (dataset == null) {
            return List.of();
        }
        ContentDefinition definition = recordDatasets.paginationSources(projectId).datasetSchema(dataset).orElse(null);
        if (definition == null) {
            return List.of();
        }
        return recordDatasets.validator(projectId).validate(
                definition, payload.path("content"), pageContentValidation.sectionTemplates(projectId), CONTENT_PATH);
    }

    private static UUID datasetRef(JsonNode payload) {
        String ref = payload == null ? null : payload.path("datasetRef").asText(null);
        if (ref == null) {
            return null;
        }
        try {
            return UUID.fromString(ref);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
