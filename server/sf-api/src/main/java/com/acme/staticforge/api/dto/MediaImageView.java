package com.acme.staticforge.api.dto;


/** A single image dimension/EXIF summary carried in the media payload (spec §11.3). */
public record MediaImageView(Integer width, Integer height, Integer orientation, String dominantColor) {}
