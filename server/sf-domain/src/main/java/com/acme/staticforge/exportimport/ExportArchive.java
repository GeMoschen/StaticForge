package com.acme.staticforge.exportimport;

import java.util.List;

/**
 * The {@code assets.json} document of an export archive: a deterministically-ordered
 * (by UUID) list of the project's current assets.
 */
public record ExportArchive(int protocolVersion, List<ExportedAsset> assets) {}
