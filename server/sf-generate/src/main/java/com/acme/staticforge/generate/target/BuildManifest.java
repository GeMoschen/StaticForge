package com.acme.staticforge.generate.target;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * What a published build contains (M22.4.1), stored by its {@link TargetWriter} next to the build: one {@link Output}
 * per file, with the asset that produced it and the media it needs. It is what lets a later run carry the build's
 * unchanged files forward and remove the ones that went away, and what decides whether the build can be an
 * incremental baseline.
 *
 * @param consistentRevision every output of the build is at least this recent: the build's revision, or for a scoped
 *     build published on top of an earlier one, that build's consistent revision (a scoped run never advances it)
 * @param completeChannels the channels in which the build holds every page of the site; empty for a scoped build
 *     published without a base
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record BuildManifest(
        int version, long runId, long revision, long consistentRevision, Set<String> completeChannels, List<Output> outputs) {

    public static final int VERSION = 1;

    private static final ObjectMapper JSON = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .setSerializationInclusion(JsonInclude.Include.NON_NULL);

    public BuildManifest {
        completeChannels = completeChannels == null ? Set.of() : Set.copyOf(completeChannels);
        outputs = outputs == null
                ? List.of()
                : outputs.stream().sorted(Comparator.comparing(Output::path)).toList();
    }

    /** What produced an output. */
    public enum Kind {
        /** A page's output in one channel (one per page number of a paginated page). */
        PAGE,
        /** A media file: a copied binary, a variant, or a rendered processed text file. */
        MEDIA,
        /** A site-wide file written by post-processing (sitemap, robots, search index, redirects). */
        SITE
    }

    /**
     * One file of the build.
     *
     * @param asset the page or media asset; {@code null} for a site file
     * @param channel the page's channel; {@code null} for media and site files
     * @param pageNumber the page number of a paginated page's output; {@code null} otherwise
     * @param locale the language a page output was rendered in (M24.3.2); {@code null} for a
     *     project without locales and for media and site files. Absent from manifests written
     *     before M24, which read back as {@code null} — exactly what they were.
     * @param dependencies the media the file's render linked or embedded (pages and processed media)
     */
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record Output(
            String path,
            Kind kind,
            UUID asset,
            String channel,
            Integer pageNumber,
            String locale,
            Set<UUID> dependencies) {

        public Output {
            dependencies = dependencies == null ? Set.of() : Set.copyOf(dependencies);
        }

        /** An output of a project without locales. */
        public Output(String path, Kind kind, UUID asset, String channel, Integer pageNumber, Set<UUID> dependencies) {
            this(path, kind, asset, channel, pageNumber, null, dependencies);
        }

        /** The 1-based page number; {@code 1} for an output that isn't a paginated page's. */
        public int number() {
            return pageNumber == null ? 1 : pageNumber;
        }
    }

    /** Whether the build holds the whole site in each of {@code channels}. */
    public boolean completeFor(Set<String> channels) {
        return !completeChannels.isEmpty() && completeChannels.containsAll(channels);
    }

    public byte[] toJson() {
        try {
            return JSON.writeValueAsBytes(this);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize build manifest", e);
        }
    }

    /** The manifest in {@code bytes}; empty when it can't be read or was written by an incompatible version. */
    public static Optional<BuildManifest> parse(byte[] bytes) {
        try {
            BuildManifest manifest = JSON.readValue(bytes, BuildManifest.class);
            return manifest.version() == VERSION ? Optional.of(manifest) : Optional.empty();
        } catch (IOException | RuntimeException e) {
            return Optional.empty();
        }
    }
}
