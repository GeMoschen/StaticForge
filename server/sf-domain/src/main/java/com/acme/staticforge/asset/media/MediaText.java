package com.acme.staticforge.asset.media;

/**
 * A text media file's content (M18.1.2).
 *
 * @param revision the {@code validFromRevision} of the version read, the {@code If-Match} token for a write
 * @param utf8 {@code false} when the stored bytes aren't valid UTF-8 and replacement characters were substituted
 */
public record MediaText(String text, String mimeType, long revision, boolean utf8) {}
