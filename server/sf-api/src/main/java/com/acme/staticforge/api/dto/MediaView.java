package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/** Full representation of a media asset at its current revision (§11.3). */
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
        FocalPointView focalPoint,
        List<MediaVariantView> variants) {}
