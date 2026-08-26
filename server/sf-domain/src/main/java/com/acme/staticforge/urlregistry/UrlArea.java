package com.acme.staticforge.urlregistry;

/**
 * The two independent render paths a {@code UrlRegistryEntry} can be cached for (spec
 * `02-url-registry` feature README): {@code PREVIEW} (the in-app preview render path,
 * {@code M6}) and {@code GENERATED} (the static-site build output, {@code M4}). Entries in
 * the two areas for the same {@code (projectId, channelKey, pageReferenceUuid)} tuple are
 * independent and never overwrite each other.
 */
public enum UrlArea {
    PREVIEW,
    GENERATED
}
