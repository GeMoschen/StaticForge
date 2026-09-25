package com.acme.staticforge.generate.stage;

import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.TextMediaCompiler;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.render.MediaRenderSession;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.render.RenderLimitException;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

/**
 * Renders processed text media for the ASSETS stage (M18.3.1, spec §18.2): the part of the stage that
 * is OCTL, kept out of {@link AssetCopyStage}'s byte copying. The source is the revision-pinned blob;
 * the rendered bytes only ever go to the build output, never back into the {@link BlobStore}.
 */
@Service
public class MediaRenderStage {

    private final BlobStore blobStore;
    private final RenderPipeline renderPipeline;
    private final TextMediaCompiler textMediaCompiler;

    public MediaRenderStage(BlobStore blobStore, RenderPipeline renderPipeline, TextMediaCompiler textMediaCompiler) {
        this.blobStore = blobStore;
        this.renderPipeline = renderPipeline;
        this.textMediaCompiler = textMediaCompiler;
    }

    /** Opens the media renderer for one build, in the project's default channel. */
    public Build open(Snapshot snapshot, OutputPathResolver paths, Long userId) {
        String channel = textMediaCompiler.defaultChannelKey(snapshot.projectId());
        return new Build(renderPipeline.mediaSession(snapshot, paths, userId, channel));
    }

    /** One build's media renderer. */
    public final class Build {

        private final MediaRenderSession session;

        private Build(MediaRenderSession session) {
            this.session = session;
        }

        /**
         * Renders one processed media file. A failure is returned as {@link Result#error()}, exactly
         * like a page held back by a render limit: the cause's own code and position, with a message
         * naming the media uid (run diagnostics group messages by code). The file is left out of the
         * build and nothing previous is substituted.
         */
        Result render(MediaOutputs.Output output) {
            SnapshotAsset media = output.asset();
            String prefix = "Media '" + (media.uid() == null ? media.uuid() : media.uid()) + "'"
                    + (output.key().locale() == null ? "" : " (" + output.key().locale() + ")") + ": ";
            byte[] source = readSource(output.payload());
            if (source == null) {
                return Result.failed(Diagnostic.error(
                        GenerationDiagnosticCodes.GEN_MEDIA_SOURCE_MISSING, prefix + "the source file is missing.", 0, 0));
            }
            try {
                return new Result(session.render(output, TextMediaCompiler.decode(source).text()), null);
            } catch (RenderLimitException e) {
                Diagnostic cause = e.diagnostic();
                return Result.failed(cause == null
                        ? Diagnostic.error("SF-GEN-0204", prefix + e.getMessage(), 0, 0)
                        : new Diagnostic(cause.severity(), cause.code(), prefix + cause.message(), cause.line(), cause.column()));
            }
        }

        private byte[] readSource(JsonNode payload) {
            String sha = payload == null ? null : payload.path("blobSha256").asText(null);
            try {
                return sha == null ? null : blobStore.get(sha);
            } catch (RuntimeException e) {
                return null;
            }
        }
    }

    /** A rendered file, or the error that kept it out of the build. */
    record Result(RenderedFile file, Diagnostic error) {

        static Result failed(Diagnostic error) {
            return new Result(null, error);
        }
    }
}
