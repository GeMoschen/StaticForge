package com.acme.staticforge.exportimport;

import java.util.List;

/**
 * The {@code settings.json} archive entry payload (feature `selective-export`, `M10.1.2`):
 * project-level configuration that lives outside the asset/revision system. Written only
 * when {@link ExportSelection#includeChannels()} and/or {@link
 * ExportSelection#includeGenerationTargets()} is set; each list is populated per its own
 * flag, independent of the other, and both are always non-null (possibly empty) so the
 * payload round-trips through JSON without null-handling on either side.
 */
public record ExportedSettings(List<ExportedChannel> channels, List<ExportedGenerationTarget> targets) {}
