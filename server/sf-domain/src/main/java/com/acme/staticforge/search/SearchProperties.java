package com.acme.staticforge.search;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Typed binding for {@code sf.search.*} (M23.1.1): where the embedded Lucene indexes live and how they are kept.
 *
 * @param indexRoot the directory holding one index directory per project ({@code {indexRoot}/{projectId}})
 * @param directory {@code filesystem} (the default, required in production) or {@code memory} (tests)
 * @param refreshInterval how often searchers pick up uncommitted index changes (near-real-time refresh)
 * @param maxTextChars the per-document cap on extracted text, also the stored snippet source
 * @param catchUpMaxRevisions a project lagging more revisions than this is rebuilt instead of replayed
 * @param rebuildBatchSize asset versions loaded per transaction during a full rebuild
 * @param ramBufferMb the index writer's RAM buffer, sized so a 5,000-page rebuild flushes rarely
 * @param liveIndexing {@code false} stops indexing after each commit (the index then only catches up on startup or
 *     reindex), for operations and for demonstrating a lagging index
 */
@ConfigurationProperties(prefix = "sf.search")
public record SearchProperties(
        @DefaultValue("./build/search-index") String indexRoot,
        @DefaultValue("filesystem") DirectoryType directory,
        @DefaultValue("1s") Duration refreshInterval,
        @DefaultValue("200000") int maxTextChars,
        @DefaultValue("5000") int catchUpMaxRevisions,
        @DefaultValue("500") int rebuildBatchSize,
        @DefaultValue("64") int ramBufferMb,
        @DefaultValue("true") boolean liveIndexing) {

    /** Where index directories are kept. */
    public enum DirectoryType {
        FILESYSTEM,
        MEMORY
    }
}
