package com.acme.staticforge.generate.render;

import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.render.RenderLimitException;

/**
 * Renders the processed text media of one build (M18.3.1): the snapshot, output paths, compile memo
 * and URL registry context of that build, so a stylesheet's links and values agree exactly with the
 * pages rendered next to it. Opened by {@link RenderPipeline#mediaSession}; never shared between builds.
 */
public final class MediaRenderSession {

    private final GenerationRenderer renderer;
    private final String channel;

    MediaRenderSession(GenerationRenderer renderer, String channel) {
        this.renderer = renderer;
        this.channel = channel;
    }

    /** The channel processed media renders in: the project's default channel. */
    public String channel() {
        return channel;
    }

    /**
     * Renders one processed media file from its decoded source.
     *
     * @throws RenderLimitException when the file fails to compile or render; only that file fails
     */
    public RenderedFile render(SnapshotAsset media, String source) {
        return renderer.renderMedia(media, source, channel);
    }
}
