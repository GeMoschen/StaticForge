package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * A redirect in a full-project export archive (M30.4.1, protocol {@code 10}): one element of {@code redirects.json}.
 * It holds no database id: the target page is named by its asset uuid (asset uuids survive an import, M9), users by
 * username. The detecting run of an {@code AUTO} entry is not carried — run ids mean nothing in another project.
 *
 * @param channel the channel key
 * @param locale the locale key; {@code ""} in a project without locales
 * @param fromPath the source output path
 * @param toAssetUuid the target page, or {@code null} for a fixed target
 * @param toPageNumber the target page number with {@code toAssetUuid}
 * @param toPath the fixed target (an output path or an absolute URL), or {@code null}
 * @param kind {@code AUTO} or {@code MANUAL}
 * @param createdByUsername who created a manual redirect; {@code null} for {@code AUTO} and for a deleted account
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ExportedRedirect(
        String channel,
        String locale,
        String fromPath,
        String toAssetUuid,
        Integer toPageNumber,
        String toPath,
        String kind,
        Instant createdAt,
        String createdByUsername) {

    /** "html: old/about.html", "html (de): alt/ueber.html" — the element label of an import warning. */
    String label() {
        return channel + (locale == null || locale.isEmpty() ? "" : " (" + locale + ")") + ": " + fromPath;
    }
}
