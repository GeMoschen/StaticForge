package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.reference.ProjectReferenceResolver;
import com.acme.staticforge.channel.ChannelServiceImpl;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.OutputChannelRepository;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;

/**
 * Save-time compilation of processed text media (M18.2.1): the source is the media file's blob,
 * compiled with the text media profile ({@link OctlCompiler#compileTextMedia}) against the project's
 * live reference resolver — the same one template save uses, so a reference that saves cleanly is
 * exactly the one {@code ReferenceMaterializer} persists as an edge. Render-time compiles go through
 * {@code CompiledTemplateCache} instead.
 *
 * <p>A processed file renders once, in the project's default channel ({@link #defaultChannelKey}),
 * because media output paths carry no channel.
 */
@Component
public class TextMediaCompiler {

    private final OctlCompiler compiler = new OctlCompiler();
    private final ProjectReferenceResolver projectReferences;
    private final OutputChannelRepository channels;
    private final BlobStore blobStore;

    public TextMediaCompiler(
            ProjectReferenceResolver projectReferences, OutputChannelRepository channels, BlobStore blobStore) {
        this.projectReferences = projectReferences;
        this.channels = channels;
        this.blobStore = blobStore;
    }

    /** The key of the project's default channel, {@code html} when none is flagged. */
    public String defaultChannelKey(long projectId) {
        return channels.findByProjectIdAndDefaultChannelTrue(projectId)
                .map(OutputChannel::getKey)
                .orElse(ChannelServiceImpl.HTML_KEY);
    }

    /** Compiles {@code source} as a file of type {@code mimeType} against the project's current assets. */
    public OctlResult compile(long projectId, String source, String mimeType) {
        return compile(source, defaultChannelKey(projectId), projectReferences.forProject(projectId), mimeType);
    }

    /** Compiles {@code source} as a file of type {@code mimeType} with an explicit channel and resolver. */
    public OctlResult compile(String source, String channelKey, ReferenceResolver resolver, String mimeType) {
        return compiler.compileTextMedia(source, channelKey, resolver, TextMediaTypes.isScriptLike(mimeType));
    }

    /** Compiles the blob a media payload points at; {@code null} when the payload has no readable blob. */
    public OctlResult compilePayload(long projectId, JsonNode payload) {
        String sha = JsonUtil.text(payload, "blobSha256").orElse(null);
        if (sha == null || !blobStore.exists(sha)) {
            return null;
        }
        return compile(projectId, decode(blobStore.get(sha)).text(), JsonUtil.text(payload, "mimeType").orElse(null));
    }

    /** Throws the standard {@code 422 SF-API-0422} problem carrying every diagnostic when {@code result} has errors. */
    public static void requireNoErrors(OctlResult result) {
        if (result.hasErrors()) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "CMS syntax has compile errors.", "diagnostics", result.diagnostics()));
        }
    }

    /**
     * Decodes stored bytes as UTF-8. Malformed input is decoded with replacement characters and
     * reported as not clean, so a file uploaded in another encoding can still be opened.
     */
    public static DecodedText decode(byte[] bytes) {
        try {
            String text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
            return new DecodedText(text, true);
        } catch (CharacterCodingException e) {
            return new DecodedText(new String(bytes, StandardCharsets.UTF_8), false);
        }
    }

    /** Text decoded from a blob; {@code utf8} is false when replacement characters were substituted. */
    public record DecodedText(String text, boolean utf8) {}
}
