package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetSummary;
import java.util.UUID;

/**
 * A template in a listing: its summary plus what pickers need from the payload (M20): whether pages may use it and
 * the parent it extends. {@code channels} are the sorted channel keys with a source, {@code usedByCount} the current
 * inbound references (pages using it, templates extending it) and {@code changedAt} when the version was last changed
 * (the Templates folder table).
 */
public record TemplateListItem(
        AssetSummary summary,
        boolean abstractTemplate,
        UUID parentTemplateRef,
        java.util.List<String> channels,
        int usedByCount,
        java.time.Instant changedAt) {}
