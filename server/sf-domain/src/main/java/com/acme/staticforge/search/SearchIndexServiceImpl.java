package com.acme.staticforge.search;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Function;
import java.util.stream.Stream;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.index.DirectoryReader;
import org.apache.lucene.index.IndexFormatTooNewException;
import org.apache.lucene.index.IndexFormatTooOldException;
import org.apache.lucene.index.IndexWriter;
import org.apache.lucene.index.IndexWriterConfig;
import org.apache.lucene.index.TieredMergePolicy;
import org.apache.lucene.index.SegmentInfos;
import org.apache.lucene.index.Term;
import org.apache.lucene.search.IndexSearcher;
import org.apache.lucene.search.SearcherManager;
import org.apache.lucene.store.ByteBuffersDirectory;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.store.LockObtainFailedException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Service;

/**
 * {@link SearchIndexService} over one Lucene directory per project: {@code {index-root}/{projectId}} on disk, or a
 * {@link ByteBuffersDirectory} kept for the lifetime of this service in {@code memory} mode (M23.1.1).
 *
 * <p>Per project, a lazily opened {@link IndexWriter} and {@link SearcherManager}, guarded by a read/write lock:
 * searches and writes hold the read lock (the writer is thread-safe), while closing and the rebuild swap hold the
 * write lock, so no search still has a reader open on files being renamed (Windows can't rename a directory with
 * open handles). A background task refreshes searchers every {@code refresh-interval}; a commit refreshes at once.
 *
 * <p>The revision stamp and schema version are the commit user data of the same commit as the documents they cover.
 */
@Service
public class SearchIndexServiceImpl implements SearchIndexService, DisposableBean {

    static final String STAMP_KEY = "sf.indexedRevision";
    static final String SCHEMA_KEY = "sf.schemaVersion";
    static final String OWNER_KEY = "sf.owner";

    private static final Logger log = LoggerFactory.getLogger(SearchIndexServiceImpl.class);
    private static final String REBUILD_INFIX = ".rebuild-";
    private static final String OLD_INFIX = ".old-";

    private final SearchProperties properties;
    private final Path root;
    private final Analyzer analyzer = SearchAnalyzers.create();
    private final SearchQueryExecutor executor;
    private final Map<Long, ProjectIndex> open = new ConcurrentHashMap<>();
    private final Map<Long, ReentrantReadWriteLock> locks = new ConcurrentHashMap<>();
    private final Map<Long, Directory> memoryDirectories = new ConcurrentHashMap<>();
    private final Set<Long> unavailable = ConcurrentHashMap.newKeySet();
    private final ScheduledExecutorService refresher;

    @Autowired
    public SearchIndexServiceImpl(SearchProperties properties, Environment environment) {
        if (environment != null
                && environment.acceptsProfiles(Profiles.of("prod"))
                && properties.directory() == SearchProperties.DirectoryType.MEMORY) {
            throw new IllegalStateException(
                    "sf.search.directory=memory is for tests only; production must use filesystem.");
        }
        this.properties = properties;
        this.root = Path.of(properties.indexRoot()).toAbsolutePath().normalize();
        this.executor = new SearchQueryExecutor(analyzer);
        if (properties.directory() == SearchProperties.DirectoryType.FILESYSTEM) {
            removeLeftovers();
        }
        this.refresher = Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform()
                .name("sf-search-refresh")
                .daemon(true)
                .factory());
        long intervalMs = Math.max(50, properties.refreshInterval().toMillis());
        refresher.scheduleWithFixedDelay(this::refreshAll, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    /** For tests: no profile check. */
    public SearchIndexServiceImpl(SearchProperties properties) {
        this(properties, null);
    }

    @Override
    public void upsert(long projectId, SearchDocument document) {
        withWriter(projectId, writer -> {
            writer.updateDocument(
                    new Term(SearchFields.UUID, document.uuid().toString()),
                    LuceneDocuments.toLucene(document, properties.maxTextChars()));
            return null;
        });
    }

    @Override
    public void delete(long projectId, UUID uuid) {
        withWriter(projectId, writer -> {
            writer.deleteDocuments(new Term(SearchFields.UUID, uuid.toString()));
            return null;
        });
    }

    @Override
    public void deleteAll(long projectId) {
        withWriter(projectId, writer -> {
            writer.deleteAll();
            return null;
        });
    }

    @Override
    public void commit(long projectId, long indexedRevision, String owner) {
        withIndex(projectId, index -> {
            commitWithStamp(index.writer, indexedRevision, owner);
            index.searchers.maybeRefreshBlocking();
            return null;
        });
    }

    @Override
    public IndexStats stats(long projectId) {
        return withWriter(projectId, writer -> {
            IndexWriter.DocStats stats = writer.getDocStats();
            return new IndexStats(stats.numDocs, stats.maxDoc);
        });
    }

    @Override
    public void forceMergeDeletes(long projectId) {
        withIndex(projectId, index -> {
            IndexCheck check = readCheck(index.directory);
            index.writer.forceMergeDeletes(true);
            if (check.indexedRevision().isPresent() && check.owner().isPresent()) {
                commitWithStamp(index.writer, check.indexedRevision().getAsLong(), check.owner().get());
            } else {
                index.writer.commit();
            }
            index.searchers.maybeRefreshBlocking();
            return null;
        });
    }

    @Override
    public OptionalLong indexedRevision(long projectId) {
        return check(projectId).indexedRevision();
    }

    @Override
    public IndexCheck check(long projectId) {
        Lock lock = lock(projectId).readLock();
        lock.lock();
        try {
            if (unavailable.contains(projectId)) {
                return IndexCheck.of(IndexCheck.Condition.UNAVAILABLE);
            }
            ProjectIndex index = open.get(projectId);
            if (index != null) {
                return readCheck(index.directory);
            }
            if (properties.directory() == SearchProperties.DirectoryType.MEMORY) {
                Directory directory = memoryDirectories.get(projectId);
                return directory == null ? IndexCheck.of(IndexCheck.Condition.MISSING) : readCheck(directory);
            }
            Path path = projectPath(projectId);
            if (!Files.isDirectory(path)) {
                return IndexCheck.of(IndexCheck.Condition.MISSING);
            }
            if (lockedElsewhere(projectId, path)) {
                return IndexCheck.of(IndexCheck.Condition.UNAVAILABLE);
            }
            try (Directory directory = FSDirectory.open(path)) {
                return readCheck(directory);
            }
        } catch (IOException e) {
            log.warn("Search index of project {} is unreadable", projectId, e);
            return IndexCheck.of(IndexCheck.Condition.UNREADABLE);
        } finally {
            lock.unlock();
        }
    }

    @Override
    public SearchHits search(long projectId, SearchQuery query) {
        return withSearcher(projectId, searcher -> executor.execute(searcher, query));
    }

    @Override
    public Rebuild startRebuild(long projectId) {
        if (unavailable.contains(projectId)) {
            throw SearchProblems.unavailable();
        }
        Path path = null;
        Directory directory;
        try {
            if (properties.directory() == SearchProperties.DirectoryType.MEMORY) {
                directory = new ByteBuffersDirectory();
            } else {
                path = resolveUnder(root, projectId + REBUILD_INFIX + System.nanoTime());
                Files.createDirectories(path);
                directory = FSDirectory.open(path);
            }
            IndexWriter writer = new IndexWriter(directory, writerConfig().setOpenMode(IndexWriterConfig.OpenMode.CREATE));
            return new LuceneRebuild(projectId, directory, path, writer);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not start a search index rebuild for project " + projectId, e);
        }
    }

    @Override
    public void close(long projectId) {
        Lock lock = lock(projectId).writeLock();
        lock.lock();
        try {
            closeQuietly(projectId, open.remove(projectId), false);
        } finally {
            lock.unlock();
        }
    }

    @Override
    public Set<Long> openProjects() {
        return Set.copyOf(open.keySet());
    }

    @Override
    public Set<Long> unavailableProjects() {
        return Set.copyOf(unavailable);
    }

    @Override
    public void destroy() {
        refresher.shutdownNow();
        for (Long projectId : Set.copyOf(open.keySet())) {
            close(projectId);
        }
        for (Directory directory : memoryDirectories.values()) {
            try {
                directory.close();
            } catch (IOException e) {
                log.debug("Closing an in-memory search index failed", e);
            }
        }
        memoryDirectories.clear();
    }

    /**
     * {@code root/name}, rejected unless it stays inside {@code root}. Names are built from internal project ids, never
     * user input; the guard keeps it that way.
     */
    static Path resolveUnder(Path root, String name) {
        Path normalizedRoot = root.toAbsolutePath().normalize();
        Path resolved = normalizedRoot.resolve(name).normalize();
        if (!resolved.startsWith(normalizedRoot) || resolved.equals(normalizedRoot)) {
            throw new IllegalArgumentException("Search index path escapes the index root: " + name);
        }
        return resolved;
    }

    // ------------------------------------------------------------------ internals

    private interface IndexAction<T> {
        T run(ProjectIndex index) throws IOException;
    }

    private interface WriterAction<T> {
        T run(IndexWriter writer) throws IOException;
    }

    private <T> T withWriter(long projectId, WriterAction<T> action) {
        return withIndex(projectId, index -> action.run(index.writer));
    }

    private <T> T withSearcher(long projectId, Function<IndexSearcher, T> action) {
        return withIndex(projectId, index -> {
            IndexSearcher searcher = index.searchers.acquire();
            try {
                return action.apply(searcher);
            } finally {
                index.searchers.release(searcher);
            }
        });
    }

    private <T> T withIndex(long projectId, IndexAction<T> action) {
        Lock lock = lock(projectId).readLock();
        lock.lock();
        try {
            return action.run(index(projectId));
        } catch (IOException e) {
            throw new UncheckedIOException("Search index operation failed for project " + projectId, e);
        } finally {
            lock.unlock();
        }
    }

    private ReentrantReadWriteLock lock(long projectId) {
        return locks.computeIfAbsent(projectId, id -> new ReentrantReadWriteLock());
    }

    /** The open index of a project; opened on first use. Callers hold the project's read lock. */
    private ProjectIndex index(long projectId) {
        if (unavailable.contains(projectId)) {
            throw SearchProblems.unavailable();
        }
        ProjectIndex index = open.computeIfAbsent(projectId, this::openIndex);
        if (index == null) {
            throw SearchProblems.unavailable();
        }
        return index;
    }

    /** Opens a project's writer; {@code null} (and the project marked unavailable) when its lock is held elsewhere. */
    private ProjectIndex openIndex(long projectId) {
        Directory directory = null;
        try {
            if (properties.directory() == SearchProperties.DirectoryType.MEMORY) {
                directory = memoryDirectories.computeIfAbsent(projectId, id -> new ByteBuffersDirectory());
            } else {
                Path path = projectPath(projectId);
                Files.createDirectories(path);
                directory = FSDirectory.open(path);
            }
            IndexWriter writer = new IndexWriter(directory, writerConfig());
            return new ProjectIndex(directory, writer, new SearcherManager(writer, null));
        } catch (LockObtainFailedException e) {
            markUnavailable(projectId, e);
            closeDirectory(directory);
            return null;
        } catch (IOException e) {
            closeDirectory(directory);
            throw new UncheckedIOException("Could not open the search index of project " + projectId, e);
        }
    }

    /**
     * Whether another process holds the write lock of a project directory this instance hasn't opened; marks the
     * project unavailable if so. The probe runs inside the open-map entry's compute, so it never races this
     * instance's own writer opening.
     */
    private boolean lockedElsewhere(long projectId, Path path) {
        boolean[] held = {false};
        open.compute(projectId, (id, existing) -> {
            if (existing != null) {
                return existing;
            }
            try (Directory directory = FSDirectory.open(path);
                    org.apache.lucene.store.Lock probe = directory.obtainLock(IndexWriter.WRITE_LOCK_NAME)) {
                probe.ensureValid();
            } catch (LockObtainFailedException e) {
                held[0] = true;
                markUnavailable(projectId, e);
            } catch (IOException e) {
                log.debug("Probing the search index lock of project {} failed", projectId, e);
            }
            return null;
        });
        return held[0];
    }

    private void markUnavailable(long projectId, Exception cause) {
        if (unavailable.add(projectId)) {
            log.error(
                    "Search index of project {} is locked by another process. Search supports a single application"
                            + " instance per index root ({}); search is unavailable for this project until restart.",
                    projectId,
                    root,
                    cause);
        }
    }

    private IndexWriterConfig writerConfig() {
        // forceMergeDeletes runs only when search maintenance decided the index holds too many deletes (M29.3.3,
        // mergeDeletesPct); it then expunges every segment's deletes instead of Lucene's own 10 % per-segment floor.
        TieredMergePolicy mergePolicy = new TieredMergePolicy();
        mergePolicy.setForceMergeDeletesPctAllowed(0);
        return new IndexWriterConfig(analyzer)
                .setMergePolicy(mergePolicy)
                .setOpenMode(IndexWriterConfig.OpenMode.CREATE_OR_APPEND)
                .setRAMBufferSizeMB(properties.ramBufferMb())
                .setCommitOnClose(false);
    }

    private static void commitWithStamp(IndexWriter writer, long indexedRevision, String owner) throws IOException {
        writer.setLiveCommitData(Map.of(
                        STAMP_KEY, Long.toString(indexedRevision),
                        SCHEMA_KEY, Integer.toString(SearchSchemaVersion.CURRENT),
                        OWNER_KEY, owner == null ? "" : owner)
                .entrySet());
        writer.commit();
    }

    private static IndexCheck readCheck(Directory directory) throws IOException {
        if (!DirectoryReader.indexExists(directory)) {
            return IndexCheck.of(IndexCheck.Condition.MISSING);
        }
        try {
            Map<String, String> data = SegmentInfos.readLatestCommit(directory).getUserData();
            return new IndexCheck(
                    IndexCheck.Condition.PRESENT,
                    parseLong(data.get(STAMP_KEY)),
                    parseInt(data.get(SCHEMA_KEY)),
                    Optional.ofNullable(data.get(OWNER_KEY)));
        } catch (IndexFormatTooOldException | IndexFormatTooNewException e) {
            return IndexCheck.of(IndexCheck.Condition.UNREADABLE);
        } catch (IOException e) {
            // CorruptIndexException and friends: the directory holds something we can't read back.
            return IndexCheck.of(IndexCheck.Condition.UNREADABLE);
        }
    }

    private static OptionalLong parseLong(String value) {
        try {
            return value == null ? OptionalLong.empty() : OptionalLong.of(Long.parseLong(value));
        } catch (NumberFormatException e) {
            return OptionalLong.empty();
        }
    }

    private static OptionalInt parseInt(String value) {
        try {
            return value == null ? OptionalInt.empty() : OptionalInt.of(Integer.parseInt(value));
        } catch (NumberFormatException e) {
            return OptionalInt.empty();
        }
    }

    private Path projectPath(long projectId) {
        return resolveUnder(root, Long.toString(projectId));
    }

    private void refreshAll() {
        for (Map.Entry<Long, ProjectIndex> entry : open.entrySet()) {
            Lock lock = lock(entry.getKey()).readLock();
            if (!lock.tryLock()) {
                continue;
            }
            try {
                ProjectIndex index = open.get(entry.getKey());
                if (index != null) {
                    index.searchers.maybeRefresh();
                }
            } catch (IOException | RuntimeException e) {
                log.debug("Refreshing the search index of project {} failed", entry.getKey(), e);
            } finally {
                lock.unlock();
            }
        }
    }

    /** Closes a project's handles; with {@code discardDirectory} the in-memory directory is dropped too. */
    private void closeQuietly(long projectId, ProjectIndex index, boolean discardDirectory) {
        if (index != null) {
            try {
                index.searchers.close();
            } catch (IOException e) {
                log.debug("Closing searchers of project {} failed", projectId, e);
            }
            try {
                // Uncommitted changes are dropped: a stamp is only ever written with the documents it covers, so the
                // next sync replays them.
                index.writer.rollback();
            } catch (IOException e) {
                log.debug("Closing the index writer of project {} failed", projectId, e);
            }
            if (properties.directory() == SearchProperties.DirectoryType.FILESYSTEM) {
                closeDirectory(index.directory);
            }
        }
        if (discardDirectory) {
            closeDirectory(memoryDirectories.remove(projectId));
        }
    }

    private static void closeDirectory(Directory directory) {
        if (directory == null) {
            return;
        }
        try {
            directory.close();
        } catch (IOException e) {
            log.debug("Closing a search index directory failed", e);
        }
    }

    private void removeLeftovers() {
        if (!Files.isDirectory(root)) {
            return;
        }
        try (DirectoryStream<Path> children = Files.newDirectoryStream(root)) {
            for (Path child : children) {
                String name = child.getFileName().toString();
                if (Files.isDirectory(child) && (name.contains(REBUILD_INFIX) || name.contains(OLD_INFIX))) {
                    log.info("Removing leftover search index directory {}", child);
                    deleteRecursively(child);
                }
            }
        } catch (IOException e) {
            log.warn("Could not scan {} for leftover search index directories", root, e);
        }
    }

    private static void deleteRecursively(Path path) {
        if (!Files.exists(path)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(path)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        } catch (IOException e) {
            log.warn("Could not delete search index directory {}", path, e);
        }
    }

    private static void move(Path from, Path to) throws IOException {
        try {
            Files.move(from, to, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(from, to);
        }
    }

    private record ProjectIndex(Directory directory, IndexWriter writer, SearcherManager searchers) {}

    private final class LuceneRebuild implements Rebuild {

        private final long projectId;
        private final Directory directory;
        private final Path path;
        private final IndexWriter writer;
        private boolean finished;

        LuceneRebuild(long projectId, Directory directory, Path path, IndexWriter writer) {
            this.projectId = projectId;
            this.directory = directory;
            this.path = path;
            this.writer = writer;
        }

        @Override
        public void add(SearchDocument document) {
            try {
                writer.updateDocument(
                        new Term(SearchFields.UUID, document.uuid().toString()),
                        LuceneDocuments.toLucene(document, properties.maxTextChars()));
            } catch (IOException e) {
                throw new UncheckedIOException("Search index rebuild failed for project " + projectId, e);
            }
        }

        @Override
        public void swap(long indexedRevision, String owner) {
            try {
                commitWithStamp(writer, indexedRevision, owner);
                writer.close();
            } catch (IOException e) {
                throw new UncheckedIOException("Search index rebuild failed for project " + projectId, e);
            }
            Lock lock = lock(projectId).writeLock();
            lock.lock();
            try {
                closeQuietly(projectId, open.remove(projectId), false);
                if (path == null) {
                    closeDirectory(memoryDirectories.put(projectId, directory));
                } else {
                    directory.close();
                    Path live = projectPath(projectId);
                    Path old = null;
                    if (Files.isDirectory(live) && lockedElsewhere(projectId, live)) {
                        throw SearchProblems.unavailable();
                    }
                    if (Files.exists(live)) {
                        old = resolveUnder(root, projectId + OLD_INFIX + System.nanoTime());
                        move(live, old);
                    }
                    move(path, live);
                    if (old != null) {
                        deleteRecursively(old);
                    }
                }
                finished = true;
            } catch (IOException e) {
                throw new UncheckedIOException("Swapping in the rebuilt search index failed for project " + projectId, e);
            } finally {
                lock.unlock();
            }
        }

        @Override
        public void close() {
            if (finished) {
                return;
            }
            try {
                writer.rollback();
            } catch (IOException | RuntimeException e) {
                log.debug("Discarding a search index rebuild of project {} failed", projectId, e);
            }
            closeDirectory(directory);
            if (path != null) {
                deleteRecursively(path);
            }
        }
    }
}
