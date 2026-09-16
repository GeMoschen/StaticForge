package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/**
 * The response of a media write that can affect processed text media (M18): the saved media, the
 * non-blocking CMS syntax warnings of a processed source, and whether a replace switched
 * {@code processCms} off because the new file is not text.
 */
public record MediaSaveResponse(MediaView media, List<Diagnostic> warnings, boolean processCmsCleared) {}
