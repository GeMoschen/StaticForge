package com.acme.staticforge.api.dto;

import com.acme.staticforge.revision.FieldChange;
import java.util.List;
import java.util.UUID;

/**
 * The difference between an asset's released and draft state in one locale (M27.1.3), in the revision-diff shape
 * (§7.6): field paths under {@code payload.…} plus {@code uid}, {@code displayName}, {@code folderPath} and
 * {@code deleted}. A {@code NEW} asset diffs against nothing; a pending deletion shows {@code deleted: false → true}.
 */
public record ChangeDiffView(UUID uuid, String locale, String status, List<FieldChange> changes) {}
