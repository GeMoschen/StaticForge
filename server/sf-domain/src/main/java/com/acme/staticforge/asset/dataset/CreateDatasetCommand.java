package com.acme.staticforge.asset.dataset;

import java.util.UUID;

/**
 * Command to create a dataset schema (M19.1.2). {@code parentFolderUuid} may be {@code null}, in
 * which case the dataset lands in the fixed {@code datasets} folder, provisioned lazily for projects
 * that predate M19. {@code titleEditor} (optional) names a {@code text} editor whose value becomes a
 * record's display name.
 */
public record CreateDatasetCommand(
        long projectId,
        UUID parentFolderUuid,
        String displayName,
        String contentDefinition,
        String titleEditor,
        String description) {}
