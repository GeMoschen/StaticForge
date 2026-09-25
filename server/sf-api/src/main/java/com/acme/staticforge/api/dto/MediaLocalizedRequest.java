package com.acme.staticforge.api.dto;

/**
 * Localizes or un-localizes a media asset (M27.3.1). Un-localizing discards the files of every language but the
 * default one: without {@code confirmDiscard = true} that is a {@code 409 SF-MEDIA-0505} listing them.
 */
public record MediaLocalizedRequest(boolean localized, Boolean confirmDiscard) {}
