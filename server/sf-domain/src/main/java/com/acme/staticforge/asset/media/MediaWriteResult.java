package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/**
 * The outcome of a media write that can affect processed text media (M18): the resulting version,
 * the non-blocking OCTL warnings of the processed source (empty when the file isn't processed), and
 * whether a {@code replace} switched {@code processCms} off because the new file isn't text.
 */
public record MediaWriteResult(AssetVersionView media, List<Diagnostic> warnings, boolean processCmsCleared) {

    public MediaWriteResult {
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
}
