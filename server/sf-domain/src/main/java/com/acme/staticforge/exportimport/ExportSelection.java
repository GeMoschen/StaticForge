package com.acme.staticforge.exportimport;

import com.acme.staticforge.asset.folder.FolderScope;
import java.util.Set;
import java.util.UUID;

/**
 * A caller-chosen subset of a project's live assets to export (feature
 * `selective-export`, `M10.1`). {@code assetUuids} holds the explicit picks — non-folder
 * assets picked individually, and/or folder UUIDs meaning "this folder and everything
 * currently live under it." {@code includeChannels} and {@code includeGenerationTargets}
 * scope the project-level settings written alongside the assets (wired in `M10.1.2`).
 *
 * <p>{@code fullStores} (feature `full-store-export`, `M11.1.3`) is a one-click "select
 * everything currently live in this store" per {@link FolderScope}: each scope named here
 * means every top-level folder of that scope is treated as though it had been individually
 * picked in {@code assetUuids} — additive to, not a replacement for, {@code assetUuids}. A
 * {@code null} {@code fullStores} is treated identically to an empty set everywhere it's
 * consumed.
 *
 * <p>An empty/{@code null} {@code assetUuids}, empty/{@code null} {@code fullStores}, and
 * both flags {@code false} means nothing would be exported; {@link
 * ProjectExportImportServiceImpl#exportSelection} rejects that case rather than silently
 * producing an empty archive — validation lives there, not in this plain data holder.
 */
public record ExportSelection(
        Set<UUID> assetUuids, boolean includeChannels, boolean includeGenerationTargets, Set<FolderScope> fullStores) {}
