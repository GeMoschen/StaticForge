package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Resolved template identity surfaced on a page. */
public record TemplateView(UUID uuid, String uid, String displayName) {}
