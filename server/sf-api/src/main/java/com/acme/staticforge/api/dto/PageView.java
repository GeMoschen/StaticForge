package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.content.ContentIssue;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * Full page representation, with the resolved template definition. {@code issues} lists the
 * page's content-validation findings (spec §10.5) — advisory on a save; {@code ERROR} findings
 * block publish.
 */
public record PageView(
        UUID uuid,
        String uid,
        String displayName,
        long revision,
        String folderPath,
        TemplateView template,
        JsonNode content,
        JsonNode bodies,
        JsonNode nav,
        JsonNode output,
        JsonNode meta,
        List<ContentIssue> issues) {}
