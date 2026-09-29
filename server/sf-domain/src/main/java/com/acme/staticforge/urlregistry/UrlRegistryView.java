package com.acme.staticforge.urlregistry;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * One area of a project's URL registry, read once, as a build (or a draft check) sees it (M32.3): every registered URL
 * by target, plus the URLs this build assigns for the first time ({@link #claims()}). The registered URL is
 * authoritative; a computed one is only used when the target has none yet, and becomes a claim the build persists when
 * it publishes ({@link UrlRegistryService#register}). A claim of a URL another target holds — registered or claimed
 * earlier in the same build — is a {@link Collision}.
 *
 * <p>Thread-safe: a build renders pages in parallel.
 */
public final class UrlRegistryView {

    /** One row's identity: a target in a channel ({@code ""} for media) and a language ({@code ""} without one). */
    public record Key(UrlTarget target, String channelKey, String localeKey) {

        public Key {
            channelKey = target.channelKey(channelKey == null ? "" : channelKey);
            localeKey = localeKey == null ? "" : localeKey;
        }
    }

    /** A URL this build assigns for the first time. */
    public record Claim(Key key, String url) {}

    /**
     * A claim of a URL that {@code holder} already holds.
     *
     * @param holderRegistered whether the holder's URL is a stored row (else another claim of this build)
     * @param holderOverridden whether the holder's row is a manual override
     */
    public record Collision(String url, Key holder, Key claimant, boolean holderRegistered, boolean holderOverridden) {}

    private record UrlKey(String channelKey, String localeKey, String url) {}

    private final Map<Key, String> registered = new HashMap<>();
    private final Map<Key, Boolean> overridden = new HashMap<>();
    private final Map<UrlKey, Key> holders = new HashMap<>();
    private final Map<Key, String> claims = new LinkedHashMap<>();
    private final List<Collision> collisions = new ArrayList<>();

    private UrlRegistryView() {}

    /** A registry with no rows: every URL is computed (and claimed). */
    public static UrlRegistryView empty() {
        return new UrlRegistryView();
    }

    /** The registry holding {@code rows} (one area of one project). */
    public static UrlRegistryView of(Collection<UrlRegistryEntry> rows) {
        UrlRegistryView view = new UrlRegistryView();
        for (UrlRegistryEntry row : rows) {
            Key key = new Key(row.target(), row.getChannelKey(), row.getLocaleKey());
            view.registered.put(key, row.getUrl());
            view.overridden.put(key, row.isOverridden());
            view.holders.put(new UrlKey(key.channelKey(), key.localeKey(), row.getUrl()), key);
        }
        return view;
    }

    /**
     * The URL of {@code target}: its registered one, else the one this build claimed for it, else {@code computed}'s,
     * which is claimed. {@code null} when there is none and {@code computed} has none either.
     */
    public synchronized String url(UrlTarget target, String channel, String localeKey, Supplier<String> computed) {
        Key key = new Key(target, channel, localeKey);
        String url = registered.get(key);
        if (url != null) {
            return url;
        }
        url = claims.get(key);
        if (url != null) {
            return url;
        }
        url = computed.get();
        if (url == null) {
            return null;
        }
        UrlKey urlKey = new UrlKey(key.channelKey(), key.localeKey(), url);
        Key holder = holders.get(urlKey);
        if (holder != null && !holder.equals(key)) {
            boolean stored = registered.containsKey(holder);
            collisions.add(new Collision(url, holder, key, stored, stored && overridden.getOrDefault(holder, false)));
        } else {
            holders.put(urlKey, key);
        }
        claims.put(key, url);
        return url;
    }

    /** The registered URL of {@code target}, without claiming anything; {@code null} when it has none. */
    public synchronized String registered(UrlTarget target, String channel, String localeKey) {
        return registered.get(new Key(target, channel, localeKey));
    }

    /** Every registered row's key. */
    public synchronized List<Key> registeredKeys() {
        return List.copyOf(registered.keySet());
    }

    /** Whether the row of {@code key} is a manual override. */
    public synchronized boolean isOverridden(Key key) {
        return overridden.getOrDefault(key, false);
    }

    /** The URLs this build assigned for the first time, in claim order. Collisions are not among them. */
    public synchronized List<Claim> claims() {
        List<Claim> result = new ArrayList<>(claims.size());
        java.util.Set<Key> colliding = new java.util.HashSet<>();
        collisions.forEach(c -> colliding.add(c.claimant()));
        claims.forEach((key, url) -> {
            if (!colliding.contains(key)) {
                result.add(new Claim(key, url));
            }
        });
        return result;
    }

    /** Every claim of a URL another target holds, in claim order. */
    public synchronized List<Collision> collisions() {
        return List.copyOf(collisions);
    }
}
