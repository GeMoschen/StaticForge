package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.cdl.CdlSources;
import java.util.Map;
import java.util.UUID;

/**
 * Command to create a dataset schema (M19.1.2). {@code parentFolderUuid} may be {@code null}, in
 * which case the dataset lands in the fixed {@code datasets} folder, provisioned lazily for projects
 * that predate M19. {@code titleEditor} (optional) names a {@code text} editor whose value becomes a
 * record's display name. {@code channelTemplates} (optional, M25.2.1) maps an output channel key to the
 * OCTL record template a record renders with in that channel; {@code null}, an empty map or a blank
 * source means no record template.
 */
public record CreateDatasetCommand(
        long projectId,
        UUID parentFolderUuid,
        String displayName,
        CdlSources cdl,
        String titleEditor,
        String description,
        Map<String, String> channelTemplates) {

    /** A dataset without record templates. */
    public CreateDatasetCommand(
            long projectId,
            UUID parentFolderUuid,
            String displayName,
            CdlSources cdl,
            String titleEditor,
            String description) {
        this(projectId, parentFolderUuid, displayName, cdl, titleEditor, description, null);
    }
}
