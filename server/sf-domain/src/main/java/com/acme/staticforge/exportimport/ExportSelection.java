package com.acme.staticforge.exportimport;

import java.util.Set;
import java.util.UUID;

/**
 * A caller-chosen subset of a project's live assets to export (feature
 * `selective-export`, `M10.1`). {@code assetUuids} holds the explicit picks — non-folder
 * assets picked individually, and/or folder UUIDs meaning "this folder and everything
 * currently live under it." {@code includeChannels} and {@code includeGenerationTargets}
 * scope the project-level settings written alongside the assets (wired in `M10.1.2`).
 *
 * <p>An empty/{@code null} {@code assetUuids} with both flags {@code false} means nothing
 * would be exported; {@link ProjectExportImportServiceImpl#exportSelection} rejects that
 * case rather than silently producing an empty archive — validation lives there, not in
 * this plain data holder.
 */
public record ExportSelection(Set<UUID> assetUuids, boolean includeChannels, boolean includeGenerationTargets) {}
