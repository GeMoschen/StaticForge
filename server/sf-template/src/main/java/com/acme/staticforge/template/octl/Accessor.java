package com.acme.staticforge.template.octl;

import java.util.List;

/**
 * An OCTL value accessor (spec §16.9): either an {@code assetType:uid[.path]} reference
 * or a plain dotted {@code identifier(.identifier)*} path.
 *
 * <p>When {@code assetType} is non-null this is an asset reference (for example
 * {@code page:home.headline} has {@code assetType = "page"}, {@code uid = "home"} and
 * {@code path = ["headline"]}). When {@code assetType} is null it is a scope path (for
 * example {@code heroImage.width} has {@code path = ["heroImage", "width"]}).
 */
public record Accessor(String assetType, String uid, List<String> path) {

    public Accessor {
        path = path == null ? List.of() : List.copyOf(path);
    }

    /** True when this accessor references another asset by {@code assetType:uid}. */
    public boolean isAssetReference() {
        return assetType != null;
    }

    /** The canonical {@code assetType:uid} key used to resolve and record this reference. */
    public String referenceKey() {
        return assetType + ":" + uid;
    }

    /** A single {@code assetType:uid} reference with no sub-path. */
    public static Accessor reference(String assetType, String uid) {
        return new Accessor(assetType, uid, List.of());
    }

    /** A dotted scope path. */
    public static Accessor path(String... segments) {
        return new Accessor(null, null, List.of(segments));
    }
}
