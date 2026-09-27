package com.acme.staticforge.generate.quality;

import com.acme.staticforge.generate.target.BuildManifest;
import java.util.Objects;
import java.util.UUID;

/**
 * Which output a fact or a finding belongs to (M30): its path and, for a page output, the page, channel, language and
 * page number that produced it — the same identity {@link BuildManifest.Output} records.
 *
 * @param path the output path, relative to the site root (no leading slash)
 * @param asset the page (or media) asset; {@code null} for a site file
 * @param channel the page's channel; {@code null} for media and site files
 * @param locale the language the output was rendered in; {@code null} in a project without locales
 * @param pageNumber the page number of a paginated page's output; {@code null} otherwise (as in the manifest)
 */
public record OutputKey(String path, UUID asset, String channel, String locale, Integer pageNumber) {

    public OutputKey {
        Objects.requireNonNull(path, "path");
    }

    /** The key of a manifest output. */
    public static OutputKey of(BuildManifest.Output output) {
        return new OutputKey(output.path(), output.asset(), output.channel(), output.locale(), output.pageNumber());
    }

    /** The 1-based page number; {@code 1} for an output that isn't a paginated page's. */
    public int number() {
        return pageNumber == null ? 1 : pageNumber;
    }
}
