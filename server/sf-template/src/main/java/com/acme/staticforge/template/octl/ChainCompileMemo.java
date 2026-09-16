package com.acme.staticforge.template.octl;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Compiled ancestors keyed by (template UUID, channel), shared by every chain compile of one build or one
 * request (M20), so a root layout with many descendants compiles once. Only valid while the loader and
 * reference resolver it was filled with answer the same way: never share one across builds, requests or
 * projects, and never fill a long-lived one through a loader that overlays unsaved sources.
 *
 * <p>Thread-safe. A chain that runs into a cycle is not memoized, because how a cycle is reported
 * depends on where the compile entered it.
 */
public final class ChainCompileMemo {

    private final Map<Key, OctlCompiler.Link> links = new ConcurrentHashMap<>();

    /** An empty memo. */
    public ChainCompileMemo() {}

    OctlCompiler.Link get(UUID uuid, String channel) {
        return links.get(new Key(uuid, channel));
    }

    void put(UUID uuid, String channel, OctlCompiler.Link link) {
        links.putIfAbsent(new Key(uuid, channel), link);
    }

    private record Key(UUID uuid, String channel) {}
}
