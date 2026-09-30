package com.acme.staticforge.asset.globals;

import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The Globals store's domain service (M17.1.2): named property sets whose fields a developer
 * declares in CDL and whose values an editor fills in.
 *
 * <p>Schema and values live in <em>one</em> asset
 * ({@code {contentDefinition, compiledDefinition, content}}), so a schema change and the value
 * migration it causes are the same asset in the same revision — there is no cross-asset cascade
 * like a section template's fan-out into pages. The two are still separate <em>operations</em>
 * because they carry different permissions (schema = {@code DEVELOPER}, values = {@code EDITOR}),
 * which the REST layer enforces per endpoint.
 *
 * <p>Everything generic stays generic: moving a set, changing its uid, listing its usages,
 * restoring it and soft-deleting it (blocked while anything still references it) all go through
 * {@link com.acme.staticforge.asset.AssetService}, and folder operations through
 * {@link com.acme.staticforge.asset.folder.FolderService} with {@code scope=GLOBALS}.
 */
public interface GlobalSetService {

    /**
     * Creates a set from CDL source, seeding {@code content} from the declared editors'
     * {@code defaultValue}s. CDL errors — including the property-set-only restrictions in
     * {@link com.acme.staticforge.template.cdl.GlobalSetCdlRules} — abort with a {@code 422}
     * carrying {@code SF-CDL-*} diagnostics, before any revision is allocated.
     */
    GlobalSetView create(CreateGlobalSetCommand cmd, RevisionContext ctx);

    /**
     * Replaces the set's CDL. Declared {@code renamedFrom} hops are applied to the existing values
     * and values of editors the new schema no longer declares are dropped, all inside the single
     * new version — so one schema change is exactly one revision touching exactly one asset. The
     * migrated values are validated against the new definition, and a structural violation rejects
     * the save with {@code 422} and field-level issues.
     */
    GlobalSetView updateSchema(UUID uuid, String contentDefinition, long expectedRevision, RevisionContext ctx);

    /**
     * Updates the schema; {@code confirmDiscard} authorizes a change that takes {@code localizable}
     * off an editor whose value carries translations, which are then reduced to the default
     * language (M24.2.2). Without it, such a save is rejected with a {@code 409}.
     */
    GlobalSetView updateSchema(
            UUID uuid, String contentDefinition, long expectedRevision, boolean confirmDiscard, RevisionContext ctx);

    /**
     * Replaces the set's values, validated against the stored compiled definition. Structural
     * findings reject the save with {@code 422} and {@code issues}; completeness findings (an empty
     * required field) save, exactly as for a page, and surface at publish time. Media and link
     * values become {@code asset_reference} rows in the same revision, and clearing one closes its
     * row (M16.3.1), which is what makes usages, delete protection and incremental rebuilds right.
     */
    GlobalSetView updateValues(UUID uuid, JsonNode content, long expectedRevision, RevisionContext ctx);

    /**
     * The findings a set's value form shows for {@code view}'s values: the {@code edit} outcome of its built-ins and
     * rules (M33.4), over the drafts.
     */
    List<com.acme.staticforge.asset.content.ContentIssue> contentIssues(long projectId, GlobalSetView view);

    /**
     * The set as of {@code revision}, or of the current version when {@code revision} is null.
     * Empty when the uuid names an asset of another type; a uuid that doesn't exist in this
     * project raises the generic {@code 404} instead, so neither case leaks existence (§8.4).
     */
    Optional<GlobalSetView> find(long projectId, UUID uuid, Long revision);

    /** Live sets of the project, optionally restricted to one folder; deleted ones are excluded. */
    List<GlobalSetView> list(long projectId, UUID folderUuid);
}
