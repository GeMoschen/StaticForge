package com.acme.staticforge.asset.page;

import java.util.UUID;

/** Resolved template identity, used when a page's template must be surfaced (spec §10.5). */
public record TemplateRefView(UUID uuid, String uid, String displayName) {}
