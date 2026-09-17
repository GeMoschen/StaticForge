package com.acme.staticforge.generate;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

/**
 * Typed binding for {@code sf.generate.*} (spec §18.6). Defaults match the spec; the
 * {@code 32MB} value in {@code application.yml} requires {@link DataSize} binding (raw
 * {@code long} cannot bind a shorthand unit string), mirroring {@code MediaProperties}.
 */
@Component
@ConfigurationProperties(prefix = "sf.generate")
public class GenerationProperties {

    /** Maximum number of render tasks processed concurrently. */
    private int parallelism = 16;

    /** Filesystem output root for generated sites (relative or absolute). */
    private String outputRoot = "./build/out";

    /** Number of previous builds to retain before the oldest is pruned. */
    private int keepBuilds = 5;

    /** Cap on the size of a single written file; larger files are rejected. */
    private DataSize maxFileSize = DataSize.ofBytes(32L * 1024 * 1024);

    /** Per-asset render budget, kept as a config string (e.g. {@code "5s"}). */
    private String renderTimeout = "5s";

    /**
     * Remove output of the old shared-root layout ({@code {outputRoot}/builds}, {@code current},
     * {@code s3}) at startup. On by default; disable to keep it around, e.g. until a web server
     * still pointing at {@code {outputRoot}/current} has been repointed.
     */
    private boolean cleanupLegacyOutput = true;

    /**
     * How many of a project's newest runs keep their stored plan (M22.1.2). Older runs keep their plan summary;
     * their entries and reason chains are deleted.
     */
    private int planRetentionRuns = 50;

    public int getParallelism() {
        return parallelism;
    }

    public void setParallelism(int parallelism) {
        this.parallelism = parallelism;
    }

    public String getOutputRoot() {
        return outputRoot;
    }

    public void setOutputRoot(String outputRoot) {
        this.outputRoot = outputRoot;
    }

    public int getKeepBuilds() {
        return keepBuilds;
    }

    public void setKeepBuilds(int keepBuilds) {
        this.keepBuilds = keepBuilds;
    }

    public DataSize getMaxFileSize() {
        return maxFileSize;
    }

    public void setMaxFileSize(DataSize maxFileSize) {
        this.maxFileSize = maxFileSize;
    }

    public String getRenderTimeout() {
        return renderTimeout;
    }

    public void setRenderTimeout(String renderTimeout) {
        this.renderTimeout = renderTimeout;
    }

    public boolean isCleanupLegacyOutput() {
        return cleanupLegacyOutput;
    }

    public void setCleanupLegacyOutput(boolean cleanupLegacyOutput) {
        this.cleanupLegacyOutput = cleanupLegacyOutput;
    }

    public int getPlanRetentionRuns() {
        return planRetentionRuns;
    }

    public void setPlanRetentionRuns(int planRetentionRuns) {
        this.planRetentionRuns = planRetentionRuns;
    }

    /** Parsed render-time budget (default {@code 5s}). */
    public Duration renderTimeoutDuration() {
        return DurationStyle.detectAndParse(renderTimeout);
    }
}
