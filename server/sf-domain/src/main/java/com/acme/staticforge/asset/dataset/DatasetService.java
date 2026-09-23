package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.revision.RevisionContext;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Dataset schemas (M19.1.2): a CDL content definition — editors only, no bodies — that the records
 * of a dataset are validated against. Developer-owned, kept in the Templates store's fixed
 * {@code datasets} folder. The REST layer requires {@code DEVELOPER} for writes and {@code VIEWER}
 * for reads.
 *
 * <p>Moving, uid changes, usages, history and restore are generic and go through
 * {@link com.acme.staticforge.asset.AssetService}; subfolders through
 * {@link com.acme.staticforge.asset.folder.FolderService} with {@code scope=TEMPLATES} and
 * {@code templateKind=DATASET}.
 */
public interface DatasetService {

    /**
     * Creates a dataset. CDL errors (and {@code body} declarations, {@code SF-CDL-0108}) abort with
     * {@code 422} and {@code diagnostics} before a revision is allocated; a {@code titleEditor} that is
     * not a declared {@code text} editor is a {@code 422} too.
     */
    DatasetView create(CreateDatasetCommand cmd, RevisionContext ctx);

    /**
     * Replaces the schema. Declared {@code renamedFrom} hops rewrite the content keys of every current
     * record of the dataset; the dataset and every rewritten record share <em>one</em> revision (§12.3,
     * M15). Values of editors the schema no longer declares are kept, exactly as for pages.
     */
    DatasetView update(UUID uuid, UpdateDatasetCommand cmd, long expectedRevision, RevisionContext ctx);

    /**
     * Updates the schema; {@code confirmDiscard} authorizes a change that takes {@code localizable}
     * off a field whose records carry translations, which are then reduced to the default language
     * (M24.2.2). Without it, such a save is rejected with a {@code 409} and nothing is written.
     */
    DatasetView update(
            UUID uuid, UpdateDatasetCommand cmd, long expectedRevision, boolean confirmDiscard, RevisionContext ctx);

    /**
     * Soft-deletes a dataset. {@code 409 SF-DOM-0121} with {@code recordCount} and {@code setCount} while it
     * still has live records or live record sets (M25) — no cascade.
     */
    void delete(UUID uuid, RevisionContext ctx);

    /**
     * The dataset as of {@code revision} (current when {@code null}). Empty when the uuid names an
     * asset of another type; a uuid unknown to the project is the generic {@code 404}.
     */
    Optional<DatasetView> find(long projectId, UUID uuid, Long revision);

    /** The project's live datasets, by display name. */
    List<DatasetView> list(long projectId);
}
