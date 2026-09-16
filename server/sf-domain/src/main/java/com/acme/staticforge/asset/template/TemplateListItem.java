package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetSummary;
import java.util.UUID;

/**
 * A template in a listing: its summary plus what pickers need from the payload (M20): whether pages may use it and
 * the parent it extends.
 */
public record TemplateListItem(AssetSummary summary, boolean abstractTemplate, UUID parentTemplateRef) {}
