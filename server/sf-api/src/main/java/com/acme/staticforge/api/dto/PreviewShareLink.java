package com.acme.staticforge.api.dto;

/** A signed preview share link (spec §19.3). */
public record PreviewShareLink(String token, String url) {}
