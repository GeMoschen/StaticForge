package com.acme.staticforge.api.dto;

import java.util.Map;

/**
 * A project's code highlighting overrides (M33 follow-up): file extension (without the dot) or MIME type → format
 * ({@code HTML}, {@code MARKDOWN}, {@code JSON}, {@code XML}, {@code CSS}, {@code JAVASCRIPT}, {@code YAML},
 * {@code PLAIN}). The code editors read them for processed text media and for templates of channels whose "Highlight
 * as" is {@code AUTO}, before the built-in detection; an extension entry wins over a MIME entry.
 */
public record CodeHighlightingView(Map<String, String> extensions, Map<String, String> mimeTypes) {}
