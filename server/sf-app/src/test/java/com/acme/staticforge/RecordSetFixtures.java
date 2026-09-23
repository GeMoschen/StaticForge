package com.acme.staticforge;

import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.RecordSetQuery;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.revision.RevisionContext;
import java.util.Objects;
import java.util.UUID;

/**
 * Record set fixtures (M25): every record lives in a record set of its dataset, so a test that needs records
 * asks for "the set of dataset D in folder F" and gets one — the existing live set when there is one, else a
 * new set with the empty query, created through the real {@link RecordSetService}.
 */
public final class RecordSetFixtures {

    private final RecordSetService recordSets;

    public RecordSetFixtures(RecordSetService recordSets) {
        this.recordSets = recordSets;
    }

    /** The uuid of a live set of {@code dataset} directly in {@code folder} ({@code null}: the Content store root). */
    public UUID setFor(long projectId, UUID dataset, UUID folder, RevisionContext ctx) {
        return recordSets.list(projectId, dataset).stream()
                .filter(set -> Objects.equals(set.folderUuid(), folder) || (folder == null && "/".equals(set.folderPath())))
                .map(RecordSetView::uuid)
                .findFirst()
                .orElseGet(() -> create(projectId, dataset, folder, "Records", ctx).uuid());
    }

    /** A new set of {@code dataset} named {@code displayName} in {@code folder} ({@code null}: the store root). */
    public RecordSetView create(long projectId, UUID dataset, UUID folder, String displayName, RevisionContext ctx) {
        return recordSets.create(
                new CreateRecordSetCommand(projectId, folder, dataset, null, displayName, RecordSetQuery.ALL), ctx);
    }
}
