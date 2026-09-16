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

    /** The accessor-root name of the global-property-set shorthand (spec §16.5, M17.3.1). */
    public static final String GLOBAL_ROOT = "CMS_GLOBAL";

    /** The {@code assetType:uid} prefix a {@link #GLOBAL_ROOT} accessor desugars into. */
    public static final String GLOBAL_PREFIX = "global";

    /**
     * Builds a parsed dotted accessor, desugaring the {@code CMS_GLOBAL.<setUid>.<path…>}
     * shorthand into the equivalent {@code global:<setUid>.<path…>} asset reference (M17.3.1).
     *
     * <p>Doing it here, at parse time, is what keeps a single resolution path: from this point on
     * the two spellings are the same AST, so compile-time uid resolution ({@code SF-TPL-0110}),
     * the recorded {@code OCTL_*} reference edges, render-time dependency tracking and the
     * snapshot/live cross-asset value lookup all treat them identically and cannot drift apart.
     *
     * <p>A bare {@code CMS_GLOBAL} with no set uid stays a plain scope path; the compiler rejects
     * it with {@code SF-TPL-0105}, which gives a far better message than an unresolvable
     * {@code global:} reference would.
     */
    public static Accessor scope(List<String> path) {
        if (path.size() >= 2 && GLOBAL_ROOT.equals(path.get(0))) {
            return new Accessor(GLOBAL_PREFIX, path.get(1), path.subList(2, path.size()));
        }
        return new Accessor(null, null, path);
    }
}
