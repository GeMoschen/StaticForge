package com.acme.staticforge.asset.media;

import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.acme.staticforge.template.render.BlockResolver;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderBudget;
import com.acme.staticforge.template.render.RenderContext;
import com.acme.staticforge.template.render.RenderResult;
import com.acme.staticforge.template.render.Renderer;
import com.acme.staticforge.template.render.UrlResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.Map;
import java.util.UUID;

/**
 * Renders a processed text media file (M18.3.1, M18.3.2): the one render context both generation and
 * preview use, so they cannot disagree on what a stylesheet or script produces. The caller supplies
 * the compiled source and the resolvers for its data (a revision-pinned snapshot in generation, live
 * or time-travel versions in preview); this class fixes everything else:
 *
 * <ul>
 *   <li>escaping {@link Escaping#NONE}, whatever the channel's default;
 *   <li>no editor values, no page, no bodies or includes (the compiler already rejects them);
 *       {@code nav:} iteration through {@link NavigationChildren};
 *   <li>{@code $CMS_META}: {@code uid}, {@code uuid}, {@code displayName}, {@code path} (the media
 *       output path), {@code revision}, {@code channel}, {@code projectKey}, {@code mimeType};
 *   <li>an {@code image/svg+xml} output is sanitized <em>after</em> rendering, so a value can't
 *       reintroduce script into an SVG that was clean on upload.
 * </ul>
 *
 * <p>Stateless and thread-safe; render limits surface as {@code RenderLimitException} like any render.
 */
public final class TextMediaRenderer {

    private final Renderer renderer = new OctlRenderer();
    private final SvgSanitizer svgSanitizer = new SvgSanitizer();

    /**
     * The file being rendered.
     *
     * @param outputPath the file's site-relative output path ({@code assets/media/main.css}); preview
     *     passes the same path so {@code $CMS_META(path)$} doesn't differ between the two
     * @param revision the revision the data is read at
     */
    public record Target(
            UUID uuid,
            String uid,
            String displayName,
            String mimeType,
            String outputPath,
            long revision,
            String channelKey,
            String projectKey) {}

    /** Resolves a {@code nav:} folder's top-level children for {@code $CMS_FOR(item : nav:uid)$}. */
    @FunctionalInterface
    public interface NavigationChildren {

        /** The children as JSON (see {@code BlockResolver#resolveNavigationChildren}), or {@code null}. */
        JsonNode children(UUID navFolderUuid, Map<String, String> args);
    }

    /** Renders {@code compiled} for {@code target}; the output of an SVG is sanitized. */
    public RenderResult render(
            CompiledTemplate compiled,
            Target target,
            UrlResolver urls,
            AssetValueResolver values,
            NavigationChildren navigation) {
        RenderBudget budget = new RenderBudget();
        RenderContext context = RenderContext.builder()
                .channel(target.channelKey())
                .escaping(Escaping.NONE)
                .values(JsonNodeFactory.instance.objectNode())
                .pageValues(JsonNodeFactory.instance.objectNode())
                .meta("uid", text(target.uid()))
                .meta("uuid", text(target.uuid().toString()))
                .meta("displayName", text(target.displayName()))
                .meta("path", text(target.outputPath()))
                .meta("revision", text(String.valueOf(target.revision())))
                .meta("channel", text(target.channelKey()))
                .meta("projectKey", text(target.projectKey()))
                .meta("mimeType", text(target.mimeType()))
                .urlResolver(urls)
                .blockResolver(navigationOnly(navigation))
                .assetValueResolver(values)
                .budget(budget)
                .build();
        RenderResult result = budget.withTemplate(target.uuid(), target.uid(), () -> renderer.render(compiled, context));
        if (!"image/svg+xml".equals(target.mimeType())) {
            return result;
        }
        return new RenderResult(svgSanitizer.sanitize(result.output()), result.dependencies(), result.warnings());
    }

    private static BlockResolver navigationOnly(NavigationChildren navigation) {
        return new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                return "";
            }

            @Override
            public String renderInclude(String uid, Map<String, String> args) {
                return "";
            }

            @Override
            public JsonNode resolveNavigationChildren(UUID navFolderUuid, Map<String, String> args) {
                return navigation == null ? null : navigation.children(navFolderUuid, args);
            }
        };
    }

    private static TextNode text(String value) {
        return TextNode.valueOf(value == null ? "" : value);
    }
}
