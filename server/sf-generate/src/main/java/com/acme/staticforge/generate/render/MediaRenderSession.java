package com.acme.staticforge.generate.render;

import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.template.render.RenderLimitException;
import java.util.function.Function;

/**
 * Renders the processed text media of one build (M18.3.1): the snapshot, output paths, compile memo
 * and URL registry context of that build, so a stylesheet's links and values agree exactly with the
 * pages rendered next to it. Opened by {@link RenderPipeline#mediaSession}; never shared between builds.
 *
 * <p>A file renders with the renderer of the locale it is written for (M27.3.2): a localized stylesheet's English
 * file reads English values and links English media; media that isn't localized renders in the default view.
 */
public final class MediaRenderSession {

    private final Function<String, GenerationRenderer> renderers;
    private final String channel;

    MediaRenderSession(Function<String, GenerationRenderer> renderers, String channel) {
        this.renderers = renderers;
        this.channel = channel;
    }

    /** The channel processed media renders in: the project's default channel. */
    public String channel() {
        return channel;
    }

    /**
     * Renders one processed media output from its decoded source.
     *
     * @throws RenderLimitException when the file fails to compile or render; only that file fails
     */
    public RenderedFile render(MediaOutputs.Output output, String source) {
        return renderers.apply(output.key().locale()).renderMedia(output, source, channel);
    }
}
