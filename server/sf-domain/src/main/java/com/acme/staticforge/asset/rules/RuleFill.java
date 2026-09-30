package com.acme.staticforge.asset.rules;

import com.acme.staticforge.template.rules.FillMode;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * A value a fill wrote (M33.3): the content {@code path} (as in findings, e.g. {@code content.slug} or
 * {@code content.gallery[1].caption}), the {@code locale} of a language-dependent field ({@code null} otherwise), the
 * computed {@code value} and the fill's {@code mode}.
 */
public record RuleFill(String path, String locale, JsonNode value, FillMode mode) {}
