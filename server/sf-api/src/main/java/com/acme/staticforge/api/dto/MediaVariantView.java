package com.acme.staticforge.api.dto;

/** A generated image variant entry in the media payload (spec §11.3). */
public record MediaVariantView(String name, String blobSha256, Integer width, String format) {}
