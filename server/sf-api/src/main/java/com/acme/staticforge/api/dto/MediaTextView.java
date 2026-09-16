package com.acme.staticforge.api.dto;

/**
 * A text media file's content (M18.1.2). {@code revision} is the {@code If-Match} token for a write;
 * {@code utf8} is {@code false} when the stored bytes are not valid UTF-8 and were decoded with replacement
 * characters, so saving would re-encode the file.
 */
public record MediaTextView(String text, String mimeType, long revision, boolean utf8) {}
