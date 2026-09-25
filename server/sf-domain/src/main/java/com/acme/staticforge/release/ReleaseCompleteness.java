package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.asset.content.PaginationSourceLookup;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.dataset.RecordDatasets;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The completeness gate of a release (M27.1.2, epic decision 10): the {@code ERROR}-severity completeness findings
 * (§10.5) of the version about to be released, validated against the <em>current</em> content definition — the same
 * one a build would validate it with. Pages validate against their template, records against their dataset schema
 * and global sets against their own schema; other types carry no editor content and are always complete.
 *
 * <p>A release checks every item it opens, so the check runs through a {@link Checker} per call (M27.1.4): templates,
 * dataset schemas, global set schemas and the validators are resolved once per checker, not once per item.
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

    /** A checker for the items of one release call in {@code projectId}; use it within that call's transaction. */
    public Checker checker(long projectId) {
        return new Checker(projectId);
    }

    /** The completeness gate for many items of one project, each shared read resolved once. Not thread-safe. */
    public final class Checker {

        private final long projectId;
        private PageContentValidation.Session pages;
        private ContentValidator validator;
        private PaginationSourceLookup sources;
        private SectionTemplateLookup sections;
        private final Map<UUID, Optional<ContentDefinition>> datasets = new HashMap<>();
        private final Map<String, ContentDefinition> globalSchemas = new HashMap<>();

        private Checker(long projectId) {
            this.projectId = projectId;
        }

        /** The blocking findings of {@code version} of an asset of {@code type}; empty when it may be released. */
        public List<ContentIssue> blockingIssues(AssetType type, AssetVersion version) {
            JsonNode payload = version.getPayload();
            List<ContentIssue> issues = switch (type) {
                case PAGE -> pages().issues(payload);
                case RECORD -> recordIssues(payload);
                case GLOBAL_SET -> validator().validate(
                        globalSchemas.computeIfAbsent(payload.path("contentDefinition").asText(""),
                                cdl -> cdlCompiler.compile(cdl).definition()),
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

        private List<ContentIssue> recordIssues(JsonNode payload) {
            UUID dataset = datasetRef(payload);
            if (dataset == null) {
                return List.of();
            }
            ContentDefinition definition =
                    datasets.computeIfAbsent(dataset, uuid -> sources().datasetSchema(uuid)).orElse(null);
            if (definition == null) {
                return List.of();
            }
            if (sections == null) {
                sections = pageContentValidation.sectionTemplates(projectId);
            }
            return validator().validate(definition, payload.path("content"), sections, CONTENT_PATH);
        }

        private PageContentValidation.Session pages() {
            if (pages == null) {
                pages = pageContentValidation.session(projectId);
            }
            return pages;
        }

        private ContentValidator validator() {
            if (validator == null) {
                validator = recordDatasets.validator(projectId);
            }
            return validator;
        }

        private PaginationSourceLookup sources() {
            if (sources == null) {
                sources = recordDatasets.paginationSources(projectId);
            }
            return sources;
        }
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
