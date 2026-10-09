package com.acme.staticforge.generate;

import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.BlobWriter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The log of generation runs (M35.24): the lines the run's {@code progress} events tell — one per stage, plus one per
 * diagnostic code when it ends — kept in memory while the run executes and stored as a content-addressed JSON blob
 * ({@code generation_run.log_blob_sha}, the blob store of the media files).
 *
 * <p><b>When it is stored.</b> At every stage change (so another node, or a run the recovery job fails after a restart,
 * still has the lines up to there) and once more, marked {@code complete}, when the run ends — whatever the end:
 * {@code SUCCESS}, {@code PARTIAL}, {@code FAILED}, {@code CANCELLED}. A flush never fails the run. Earlier snapshots of a
 * log are unreferenced blobs the {@code blob-sweep} job collects.
 *
 * <p><b>Bounded.</b> At most {@code sf.generate.log-max-lines} lines, each at most {@link #MAX_TEXT} characters. Past the
 * cap one marker line says so, later lines are dropped ({@code truncated}); the closing {@code REPORT} lines are always
 * kept (at most {@link #REPORT_RESERVE} beyond the cap).
 *
 * <p><b>Retention.</b> The log lives and dies with its run: {@code generation-run-retention} deletes the row, and the
 * blob sweep the unreferenced blob.
 */
@Component
public class RunLogStore {

    private static final Logger log = LoggerFactory.getLogger(RunLogStore.class);

    /** The longest line text; longer ones are cut and end in an ellipsis. */
    static final int MAX_TEXT = 1000;

    /** Lines of the closing report allowed beyond the cap. */
    static final int REPORT_RESERVE = 60;

    static final String LEVEL_INFO = "info";
    static final String LEVEL_WARNING = "warning";
    static final String LEVEL_ERROR = "error";

    private static final String STAGE_REPORT = "REPORT";
    private static final String MIME_TYPE = "application/json";

    /**
     * One log line. {@code n} counts from 1 per run; {@code level} is {@code info}, {@code warning} or {@code error};
     * {@code files}, {@code errors} and {@code warnings} are the run's counters when the line was written, so the
     * latest line carries the run's progress.
     */
    public record Line(int n, Instant time, String stage, String level, String text, long files, int errors, int warnings) {}

    /**
     * A run's log as read.
     *
     * @param complete the run ended and its log is final
     * @param truncated lines were dropped at the cap
     * @param pruned the run has ended but has no stored log (it ended before logs were kept, or its log is gone)
     */
    public record Log(List<Line> lines, boolean complete, boolean truncated, boolean pruned) {

        public Log {
            lines = List.copyOf(lines);
        }

        /** The lines after line {@code from} (all of them for {@code from <= 0}). */
        public Log after(int from) {
            return from <= 0 ? this : new Log(lines.stream().filter(line -> line.n() > from).toList(), complete, truncated, pruned);
        }
    }

    /** A run's lines while it executes. */
    private static final class Buffer {
        final List<Line> lines = new ArrayList<>();
        boolean truncated;
        String lastFlushed;
        String lastStage;

        Buffer(Log stored) {
            if (stored != null) {
                lines.addAll(stored.lines());
                truncated = stored.truncated();
                if (!lines.isEmpty()) {
                    lastStage = lines.get(lines.size() - 1).stage();
                }
            }
        }
    }

    private final GenerationRunRepository runs;
    private final BlobWriter blobWriter;
    private final BlobStore blobStore;
    private final ObjectMapper mapper;
    private final GenerationProperties properties;
    private final TransactionTemplate tx;
    private final Map<Long, Buffer> buffers = new ConcurrentHashMap<>();

    public RunLogStore(
            GenerationRunRepository runs,
            BlobWriter blobWriter,
            BlobStore blobStore,
            ObjectMapper mapper,
            GenerationProperties properties,
            PlatformTransactionManager transactionManager) {
        this.runs = runs;
        this.blobWriter = blobWriter;
        this.blobStore = blobStore;
        this.mapper = mapper;
        this.properties = properties;
        // Always its own transaction: the end of a run is logged from after-commit callbacks and executor threads.
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Appends a line to run {@code runId}'s log, and stores the log when the line starts a new stage.
     *
     * @return the line, or {@code null} when the cap dropped it
     */
    public Line append(long runId, String stage, String level, String text, long files, int errors, int warnings) {
        Buffer buffer = buffer(runId);
        boolean stageChanged;
        Line line;
        synchronized (buffer) {
            line = add(buffer, stage, level, text, files, errors, warnings);
            stageChanged = line != null && !stage.equals(buffer.lastStage) && !STAGE_REPORT.equals(stage);
            if (line != null) {
                buffer.lastStage = stage;
            }
            if (stageChanged) {
                store(runId, buffer, false);
            }
        }
        return line;
    }

    private Line add(Buffer buffer, String stage, String level, String text, long files, int errors, int warnings) {
        int cap = Math.max(2, properties.getLogMaxLines());
        boolean report = STAGE_REPORT.equals(stage);
        int size = buffer.lines.size();
        if (report) {
            if (size >= cap + REPORT_RESERVE) {
                return null;
            }
        } else {
            if (buffer.truncated) {
                return null;
            }
            if (size >= cap - 1) {
                // Room for the marker only.
                buffer.truncated = true;
                buffer.lines.add(new Line(size + 1, Instant.now(), stage, LEVEL_WARNING,
                        "Log truncated: further lines are not kept (limit " + cap + " lines).", files, errors, warnings));
                return null;
            }
        }
        Line line = new Line(size + 1, Instant.now(), stage, level, clip(text), files, errors, warnings);
        buffer.lines.add(line);
        return line;
    }

    /** Stores the log of run {@code runId} as final and forgets its in-memory lines. A no-op for a run without lines here. */
    public void finish(long runId) {
        Buffer buffer = buffers.get(runId);
        if (buffer == null) {
            return;
        }
        synchronized (buffer) {
            store(runId, buffer, true);
        }
        buffers.remove(runId, buffer);
    }

    /** The lines of run {@code runId} while this node executes it; empty otherwise. */
    public Optional<Log> live(long runId) {
        Buffer buffer = buffers.get(runId);
        if (buffer == null) {
            return Optional.empty();
        }
        synchronized (buffer) {
            return Optional.of(new Log(buffer.lines, false, buffer.truncated, false));
        }
    }

    /**
     * The log of {@code run}: the lines this node holds while it executes the run, else the stored log. A run that has
     * ended without one reads {@code pruned}; a run that hasn't started logging reads empty and not complete.
     */
    public Log read(GenerationRun run) {
        Optional<Log> live = live(run.getId());
        if (live.isPresent()) {
            return live.get();
        }
        Log stored = stored(run);
        if (stored != null) {
            return stored;
        }
        return run.getStatus().isTerminal() ? new Log(List.of(), true, false, true) : new Log(List.of(), false, false, false);
    }

    private Buffer buffer(long runId) {
        Buffer buffer = buffers.get(runId);
        if (buffer != null) {
            return buffer;
        }
        // A run this node didn't execute (cancelled or recovered here) continues the log its executor stored.
        Log stored = runs.findById(runId).map(this::stored).orElse(null);
        Buffer created = new Buffer(stored);
        Buffer raced = buffers.putIfAbsent(runId, created);
        return raced != null ? raced : created;
    }

    /** The stored log of {@code run}; {@code null} when it has none or it can't be read. */
    private Log stored(GenerationRun run) {
        String sha = run.getLogBlobSha();
        if (sha == null || sha.isBlank()) {
            return null;
        }
        try {
            JsonNode json = mapper.readTree(blobStore.get(sha.trim()));
            List<Line> lines = new ArrayList<>();
            for (JsonNode node : json.path("lines")) {
                lines.add(new Line(
                        node.path("n").asInt(),
                        Instant.parse(node.path("time").asText()),
                        node.path("stage").asText(),
                        node.path("level").asText(LEVEL_INFO),
                        node.path("text").asText(),
                        node.path("files").asLong(),
                        node.path("errors").asInt(),
                        node.path("warnings").asInt()));
            }
            return new Log(lines, json.path("complete").asBoolean(false), json.path("truncated").asBoolean(false), false);
        } catch (Exception e) {
            log.warn("The stored log of generation run {} can't be read: {}", run.getId(), e.toString());
            return null;
        }
    }

    /** Writes the blob and points the run at it; a failure is logged and leaves the run (and the earlier log) as it was. */
    private void store(long runId, Buffer buffer, boolean complete) {
        try {
            ObjectNode root = mapper.createObjectNode();
            root.put("complete", complete);
            root.put("truncated", buffer.truncated);
            ArrayNode lines = root.putArray("lines");
            for (Line line : buffer.lines) {
                ObjectNode node = lines.addObject();
                node.put("n", line.n());
                node.put("time", line.time().toString());
                node.put("stage", line.stage());
                node.put("level", line.level());
                node.put("text", line.text());
                node.put("files", line.files());
                node.put("errors", line.errors());
                node.put("warnings", line.warnings());
            }
            byte[] bytes = mapper.writeValueAsBytes(root);
            String sha = sha256(bytes);
            if (sha.equals(buffer.lastFlushed)) {
                return;
            }
            tx.executeWithoutResult(status -> {
                blobWriter.store(sha, bytes, MIME_TYPE);
                runs.updateLogBlobSha(runId, sha);
            });
            buffer.lastFlushed = sha;
        } catch (Exception e) {
            log.warn("Could not store the log of generation run {}: {}", runId, e.toString());
        }
    }

    private static String clip(String text) {
        String value = text == null ? "" : text;
        return value.length() <= MAX_TEXT ? value : value.substring(0, MAX_TEXT - 1) + "…";
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
