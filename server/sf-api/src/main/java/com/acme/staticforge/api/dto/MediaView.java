package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * Full representation of a media asset at its current revision (§11.3). {@code textEditable} is true for text
 * MIME types, which can be edited as text and have {@code processCms} (CMS syntax processing, M18) switched on.
 *
 * <p>{@code altText}/{@code caption} are always the value resolved for the requested (or default)
 * language, so clients written before M24 keep working; {@code altTextL10n}/{@code captionL10n}
 * carry the per-language values and are {@code null} in a project without locales.
 *
 * <p>The file fields ({@code blobSha256} … {@code variants}, {@code processCms}) describe the default language's file.
 * A {@code localized} media asset (M27.3.1) has one file per language: {@code localeFiles} maps every project language
 * to the file it renders, own or by fallback; {@code null} for media that isn't localized.
 */
public record MediaView(
        UUID uuid,
        String uid,
        String displayName,
        long revision,
        String blobSha256,
        String fileName,
        String mimeType,
        long sizeBytes,
        MediaImageView image,
        String altText,
        String caption,
        String copyright,
        java.util.Map<String, String> altTextL10n,
        java.util.Map<String, String> captionL10n,
        FocalPointView focalPoint,
        List<MediaVariantView> variants,
        boolean processCms,
        boolean textEditable,
        boolean localized,
        java.util.Map<String, MediaLocaleFileView> localeFiles,
        java.util.Map<String, LocaleReleaseView> release,
        com.fasterxml.jackson.databind.JsonNode scheduled) {}
