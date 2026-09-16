package com.acme.staticforge.api.dto;

/** Request body for {@code PUT /media/{uuid}/process}: switches CMS syntax processing of a text media file on or off (M18.1.1). */
public record MediaProcessRequest(boolean processCms) {}
