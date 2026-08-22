package com.acme.staticforge.api.dto;

/** Request body for {@code PUT /media/{uuid}} (alt text, caption, copyright, focal point). */
public record MediaMetadataRequest(String altText, String caption, String copyright, FocalPointView focalPoint) {}
