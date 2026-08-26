package com.acme.staticforge.template.render;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The inputs to a single render (spec §16.5): the channel + escaping mode, the asset's
 * editor values, the {@code $CMS_META} values, the enclosing page for {@code $CMS_PAGE.*}
 * read-only access, and an optional {@link UrlResolver} for {@code $CMS_REF}. Built via
 * {@link Builder} and immutable once built; never shared across concurrent renders.
 */
public final class RenderContext {

    private final String channelKey;
    private final Escaping escaping;
    private final JsonNode values;
    private final Map<String, JsonNode> meta;
    private final JsonNode pageValues;
    private final UrlResolver urlResolver;
    private final BlockResolver blockResolver;

    private RenderContext(
            String channelKey,
            Escaping escaping,
            JsonNode values,
            Map<String, JsonNode> meta,
            JsonNode pageValues,
            UrlResolver urlResolver,
            BlockResolver blockResolver) {
        this.channelKey = channelKey;
        this.escaping = escaping;
        this.values = values;
        this.meta = meta;
        this.pageValues = pageValues;
        this.urlResolver = urlResolver;
        this.blockResolver = blockResolver;
    }

    /** A fluent builder for {@link RenderContext}. */
    public static Builder builder() {
        return new Builder();
    }

    /** The channel key, default {@code "html"}. */
    public String channelKey() {
        return channelKey;
    }

    /** The default escaping mode, default {@link Escaping#HTML}. */
    public Escaping escaping() {
        return escaping;
    }

    /** The editor value object (a JSON object keyed by editor name). */
    public JsonNode values() {
        return values;
    }

    /** The {@code $CMS_META} values, keyed by meta name. */
    public Map<String, JsonNode> meta() {
        return meta;
    }

    /** The enclosing page's editor values for read-only {@code $CMS_PAGE.*} access. */
    public JsonNode pageValues() {
        return pageValues;
    }

    /** The URL resolver, or {@code null} when {@code $CMS_REF} has no target resolver. */
    public UrlResolver urlResolver() {
        return urlResolver;
    }

    /** The block resolver, or {@code null} when block instructions render as empty. */
    public BlockResolver blockResolver() {
        return blockResolver;
    }

    /** Fluent builder for {@link RenderContext}. */
    public static final class Builder {
        private String channel = "html";
        private Escaping escaping = Escaping.HTML;
        private JsonNode values = JsonNodeFactory.instance.objectNode();
        private final Map<String, JsonNode> meta = new LinkedHashMap<>();
        private JsonNode pageValues = MissingNode.getInstance();
        private UrlResolver urlResolver;
        private BlockResolver blockResolver;

        /** Sets the channel key (for example {@code "markdown"}). */
        public Builder channel(String key) {
            this.channel = key == null ? "html" : key;
            return this;
        }

        /** Sets the default escaping mode. */
        public Builder escaping(Escaping e) {
            this.escaping = e == null ? Escaping.HTML : e;
            return this;
        }

        /** Sets the editor value object (a JSON object keyed by editor name). */
        public Builder values(JsonNode editorValues) {
            this.values = editorValues == null ? JsonNodeFactory.instance.objectNode() : editorValues;
            return this;
        }

        /** Sets a single {@code $CMS_META} value (uid, uuid, displayName, path, …). */
        public Builder meta(String key, JsonNode value) {
            this.meta.put(key, value);
            return this;
        }

        /** Sets the enclosing page's editor values (for {@code $CMS_PAGE.*}). */
        public Builder pageValues(JsonNode pageEditorValues) {
            this.pageValues = pageEditorValues == null ? MissingNode.getInstance() : pageEditorValues;
            return this;
        }

        /** Sets the URL resolver used by {@code $CMS_REF}. */
        public Builder urlResolver(UrlResolver resolver) {
            this.urlResolver = resolver;
            return this;
        }

        /** Sets the block resolver used by {@code $CMS_BODY}/{@code $CMS_INCLUDE}. */
        public Builder blockResolver(BlockResolver resolver) {
            this.blockResolver = resolver;
            return this;
        }

        /** Builds an immutable {@link RenderContext}. */
        public RenderContext build() {
            return new RenderContext(channel, escaping, values, Map.copyOf(meta), pageValues, urlResolver, blockResolver);
        }
    }
}
