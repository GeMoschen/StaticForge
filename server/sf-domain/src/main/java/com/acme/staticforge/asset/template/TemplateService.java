package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * Section and page template domain operations (spec §12, §13, §20.2). Templates are assets
 * ({@code SECTION_TEMPLATE} / {@code PAGE_TEMPLATE}) whose CDL source, compiled content
 * definition and per-channel OCTL sources live in the asset version payload. Every mutation
 * compiles on save and rejects invalid CDL/OCTL with a 422 carrying the diagnostics; no
 * invalid template is ever persisted.
 */
public interface TemplateService {

    /**
     * Creates a template, compiling the CDL and each channel template before persisting. A page template's
     * channels compile against their {@code $CMS_EXTENDS} chain and {@code parentTemplateRef} is derived from them
     * (M20).
     */
    TemplateView create(CreateTemplateCommand cmd, RevisionContext ctx);

    /**
     * Applies a full state change, recompiling the CDL and each channel template. A CDL
     * change carrying {@code renamedFrom} hints additionally migrates affected page section
     * content project-wide in a single revision (§12.3).
     */
    TemplateView update(UUID uuid, UpdateTemplateCommand cmd, long expectedRevision, RevisionContext ctx);

    /** Compiles and stores (or replaces) the OCTL source for a single channel. */
    TemplateView saveChannel(UUID uuid, String channelKey, String octlSource, long expectedRevision, RevisionContext ctx);

    /** Removes the channel template for a single channel. */
    TemplateView deleteChannel(UUID uuid, String channelKey, long expectedRevision, RevisionContext ctx);

    /** The template's current (open) version, or throws 404. */
    TemplateView get(long projectId, UUID uuid);

    /**
     * Current-version summaries of the given template kind within a project. Lazily
     * self-heals the project's fixed template folders and reparents any pre-M13 template still
     * sitting at the hidden root (spec M13.1.4) before listing.
     */
    Page<TemplateListItem> list(long projectId, AssetType kind, Pageable pageable, RevisionContext ctx);

    /**
     * The diagnostics saving {@code source} as the template's {@code channelKey} would produce (M20.4.1), without
     * saving: references resolve against the project, a page template's chain links against the live templates,
     * and names are checked against its effective definition. {@code cdlSource} replaces the stored CDL when not
     * {@code null}, so unsaved editors count.
     */
    List<Diagnostic> validateChannel(long projectId, UUID uuid, String channelKey, String source, String cdlSource);

    /** Soft-deletes the template via the asset service. */
    void delete(UUID uuid, RevisionContext ctx);
}
