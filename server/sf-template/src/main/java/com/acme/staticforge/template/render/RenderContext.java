package com.acme.staticforge.template.render;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The inputs to a single render (spec §16.5): the channel + escaping mode, the asset's
 * editor values, the {@code $CMS_META} values, the enclosing page for {@code $CMS_PAGE.*}
 * read-only access, an optional {@link UrlResolver} for {@code $CMS_REF}, and an optional
 * {@link AssetValueResolver} for cross-asset values, and the {@code CMS_PAGINATION} value of a paginated page (M21.3.1). Built via
 * {@link Builder} and immutable once built; never shared across concurrent renders.
 *
 * <p>The optional {@link RenderBudget} is the one mutable part: it is deliberately shared by a
 * top-level render's context and every nested context its resolvers build (same thread), so
 * guard rails apply to the whole page. It must never be shared across pipeline entries.
 */
public final class RenderContext {

    private final String channelKey;
    private final Escaping escaping;
    private final JsonNode values;
    private final Map<String, JsonNode> meta;
    private final JsonNode pageValues;
    private final JsonNode pagination;
    private final String locale;
    private final List<String> localeChain;
    private final JsonNode localesScope;
    private final UrlResolver urlResolver;
    private final BlockResolver blockResolver;
    private final AssetValueResolver assetValueResolver;
    private final RenderBudget budget;

    private RenderContext(
            String channelKey,
            Escaping escaping,
            JsonNode values,
            Map<String, JsonNode> meta,
            JsonNode pageValues,
            JsonNode pagination,
            String locale,
            List<String> localeChain,
            JsonNode localesScope,
            UrlResolver urlResolver,
            BlockResolver blockResolver,
            AssetValueResolver assetValueResolver,
            RenderBudget budget) {
        this.channelKey = channelKey;
        this.escaping = escaping;
        this.values = values;
        this.meta = meta;
        this.pageValues = pageValues;
        this.pagination = pagination;
        this.locale = locale;
        this.localeChain = localeChain;
        this.localesScope = localesScope;
        this.urlResolver = urlResolver;
        this.blockResolver = blockResolver;
        this.assetValueResolver = assetValueResolver;
        this.budget = budget;
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

    /**
     * The read-only {@code CMS_PAGINATION} value of a paginated page (M21.3.1), built by the caller; a missing node on
     * every other page, so {@code $CMS_IF(CMS_PAGINATION)$} is false there.
     */
    public JsonNode pagination() {
        return pagination;
    }

    /** The BCP 47 tag this render targets, or {@code null} in a project without locales (M24.3.1). */
    public String locale() {
        return locale;
    }

    /**
     * The fallback chain language-dependent values resolve through, the render locale first.
     * Empty in a project without locales, which is how every L10N lookup stays a no-op there.
     */
    public List<String> localeChain() {
        return localeChain;
    }

    /**
     * The {@code CMS_LOCALES} iterable — one item per project locale with
     * {@code {code, language, label, current, href}} — or a missing node when the project has no
     * locales, so {@code $CMS_FOR(l : CMS_LOCALES)$} renders nothing there.
     */
    public JsonNode locales() {
        return localesScope;
    }

    /** The URL resolver, or {@code null} when {@code $CMS_REF} has no target resolver. */
    public UrlResolver urlResolver() {
        return urlResolver;
    }

    /** The block resolver, or {@code null} when block instructions render as empty. */
    public BlockResolver blockResolver() {
        return blockResolver;
    }

    /** The cross-asset value resolver, or {@code null} when cross-asset values render as empty. */
    public AssetValueResolver assetValueResolver() {
        return assetValueResolver;
    }

    /** The render budget shared with nested renders, or {@code null} for a standalone render with its own budget. */
    public RenderBudget budget() {
        return budget;
    }

    /** Fluent builder for {@link RenderContext}. */
    public static final class Builder {
        private String channel = "html";
        private Escaping escaping = Escaping.HTML;
        private JsonNode values = JsonNodeFactory.instance.objectNode();
        private final Map<String, JsonNode> meta = new LinkedHashMap<>();
        private JsonNode pageValues = MissingNode.getInstance();
        private JsonNode pagination = MissingNode.getInstance();
        private String locale;
        private List<String> localeChain = List.of();
        private JsonNode localesScope = MissingNode.getInstance();
        private UrlResolver urlResolver;
        private BlockResolver blockResolver;
        private AssetValueResolver assetValueResolver;
        private RenderBudget budget;

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

        /** Sets the {@code CMS_PAGINATION} value of a paginated page; {@code null} means not paginated. */
        public Builder pagination(JsonNode paginationScope) {
            this.pagination = paginationScope == null ? MissingNode.getInstance() : paginationScope;
            return this;
        }

        /** Sets the render locale and the chain language-dependent values resolve through (M24.3.1). */
        public Builder locale(String tag, List<String> chain) {
            this.locale = tag;
            this.localeChain = chain == null ? List.of() : List.copyOf(chain);
            return this;
        }

        /** Sets the {@code CMS_LOCALES} iterable; {@code null} means the project has no locales. */
        public Builder locales(JsonNode locales) {
            this.localesScope = locales == null ? MissingNode.getInstance() : locales;
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

        /** Sets the resolver used for cross-asset values ({@code $CMS_VALUE(page:uid.editor)$}). */
        public Builder assetValueResolver(AssetValueResolver resolver) {
            this.assetValueResolver = resolver;
            return this;
        }

        /** Sets the budget of the enclosing top-level render, so this (nested) render counts against it. */
        public Builder budget(RenderBudget renderBudget) {
            this.budget = renderBudget;
            return this;
        }

        /** Builds an immutable {@link RenderContext}. */
        public RenderContext build() {
            return new RenderContext(
                    channel, escaping, values, Map.copyOf(meta), pageValues, pagination, locale, localeChain,
                    localesScope, urlResolver, blockResolver, assetValueResolver, budget);
        }
    }
}
