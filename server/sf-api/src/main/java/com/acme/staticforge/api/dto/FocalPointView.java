package com.acme.staticforge.api.dto;

/** Normalized focal point ({0..1} relative coordinates) for smart cropping (spec §11.3). */
public record FocalPointView(Double x, Double y) {}
