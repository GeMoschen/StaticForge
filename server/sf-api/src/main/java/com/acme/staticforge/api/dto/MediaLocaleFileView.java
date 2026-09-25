package com.acme.staticforge.api.dto;

/**
 * The file one language of a localized media asset renders (M27.3.1): its own file ({@code own = true}) or the one it
 * falls back to along its chain, owned by {@code fromLocale}.
 */
public record MediaLocaleFileView(
        boolean own,
        String fromLocale,
        String blobSha256,
        String fileName,
        String mimeType,
        long sizeBytes,
        MediaImageView image,
        boolean processCms,
        boolean textEditable) {}
