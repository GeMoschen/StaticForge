package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory page templates for inheritance tests (M20): a {@link ReferenceResolver} resolving
 * {@code page_template:<uid>} and a {@link ParentTemplateLoader} serving each template's channel sources and
 * own definition. UUIDs derive from the uid, so a test can rename a template's uid without changing its UUID
 * via {@link #rename}.
 */
public final class InMemoryTemplates {

    private static final CdlCompiler CDL = new CdlCompiler();

    private final Map<UUID, Template> byUuid = new LinkedHashMap<>();
    private final Map<String, UUID> uuidByUid = new HashMap<>();
    private final AtomicInteger loads = new AtomicInteger();

    private record Template(String uid, ContentDefinition definition, Map<String, String> channels) {}

    /** A deterministic UUID for {@code uid}. */
    public static UUID uuidOf(String uid) {
        return UUID.nameUUIDFromBytes(("page_template:" + uid).getBytes());
    }

    /** Adds (or replaces) a template with an {@code html} channel. */
    public InMemoryTemplates add(String uid, String cdl, String htmlSource) {
        return add(uid, cdl, Map.of("html", htmlSource));
    }

    /** Adds (or replaces) a template; {@code cdl} may be {@code null} for no editors. */
    public InMemoryTemplates add(String uid, String cdl, Map<String, String> channels) {
        UUID uuid = uuidByUid.getOrDefault(uid, uuidOf(uid));
        uuidByUid.put(uid, uuid);
        byUuid.put(uuid, new Template(uid, definition(cdl), new HashMap<>(channels)));
        return this;
    }

    /** Gives the template {@code from} the uid {@code to}, keeping its UUID; the old uid keeps resolving (stale alias). */
    public InMemoryTemplates rename(String from, String to) {
        UUID uuid = uuidByUid.get(from);
        Template template = byUuid.get(uuid);
        uuidByUid.put(to, uuid);
        byUuid.put(uuid, new Template(to, template.definition(), template.channels()));
        return this;
    }

    public static ContentDefinition definition(String cdl) {
        if (cdl == null) {
            return new ContentDefinition(null, null);
        }
        var result = CDL.compile(cdl);
        if (result.hasErrors()) {
            throw new IllegalArgumentException("Fixture CDL has errors: " + result.diagnostics());
        }
        return result.definition();
    }

    public ReferenceResolver resolver() {
        return (assetType, uid) -> "page_template".equals(assetType)
                ? Optional.ofNullable(uuidByUid.get(uid))
                : Optional.of(UUID.nameUUIDFromBytes((assetType + ":" + uid).getBytes()));
    }

    public ParentTemplateLoader loader() {
        return (uuid, channel) -> {
            loads.incrementAndGet();
            Template template = byUuid.get(uuid);
            return template == null
                    ? Optional.empty()
                    : Optional.of(new ParentSource(uuid, template.uid(), template.channels().get(channel), template.definition()));
        };
    }

    /** How often {@link #loader()} was asked for a template. */
    public int loads() {
        return loads.get();
    }

    /** Compiles template {@code uid}'s {@code channel} source with its chain. */
    public OctlResult compile(String uid, String channel) {
        return compile(uid, channel, null);
    }

    /** Compiles template {@code uid}'s {@code channel} source with its chain and a shared memo. */
    public OctlResult compile(String uid, String channel, ChainCompileMemo memo) {
        UUID uuid = uuidByUid.get(uid);
        Template template = byUuid.get(uuid);
        return new OctlCompiler().compile(
                template.channels().get(channel), channel, resolver(), template.definition(),
                new Inheritance(uuid, uid, loader(), memo));
    }
}
