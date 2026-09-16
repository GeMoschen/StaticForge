package com.acme.staticforge.api.dto;

/** Request body for {@code PUT /media/{uuid}/text} and {@code POST /media/{uuid}/text/validate} (M18.1.2, M18.2.1). */
public record MediaTextRequest(String text) {}
