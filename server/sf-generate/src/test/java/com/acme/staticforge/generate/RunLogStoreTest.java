package com.acme.staticforge.generate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.BlobWriter;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * The run log (M35.24): lines are numbered, stored as a blob at stage changes and at the end, read back (also by a node
 * that didn't execute the run), bounded by the cap with a marker, and a run without a stored log reads as pruned.
 */
class RunLogStoreTest {

    private final Map<String, byte[]> blobs = new HashMap<>();
    private final Map<Long, GenerationRun> rows = new HashMap<>();
    private GenerationProperties properties;
    private RunLogStore store;

    @BeforeEach
    void setUp() {
        GenerationRunRepository runs = mock(GenerationRunRepository.class);
        BlobWriter writer = mock(BlobWriter.class);
        doAnswer(call -> {
            blobs.put(call.getArgument(0), call.getArgument(1));
            return null;
        }).when(writer).store(anyString(), any(byte[].class), eq("application/json"));
        BlobStore blobStore = mock(BlobStore.class);
        when(blobStore.get(anyString())).thenAnswer(call -> {
            byte[] bytes = blobs.get(call.<String>getArgument(0));
            if (bytes == null) {
                throw new IllegalStateException("absent");
            }
            return bytes;
        });
        when(runs.updateLogBlobSha(org.mockito.ArgumentMatchers.anyLong(), anyString())).thenAnswer(call -> {
            rows.get(call.<Long>getArgument(0)).setLogBlobSha(call.getArgument(1));
            return 1;
        });
        when(runs.findById(org.mockito.ArgumentMatchers.anyLong()))
                .thenAnswer(call -> Optional.ofNullable(rows.get(call.<Long>getArgument(0))));
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        properties = new GenerationProperties();
        store = new RunLogStore(runs, writer, blobStore, new ObjectMapper(), properties, tm);
    }

    private GenerationRun run(long id, RunStatus status) {
        // A real entity: the id is generated, so it is set by reflection.
        GenerationRun run = new GenerationRun(
                1L, null, GenerationMode.FULL, null, null, status, null, null, null, 0, 0, 0, 0, 0, null, null);
        try {
            var field = GenerationRun.class.getDeclaredField("id");
            field.setAccessible(true);
            field.set(run, id);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
        rows.put(id, run);
        return run;
    }

    @Test
    void linesAreNumberedFromOneAndTheFinishStoresACompleteLogReadBackWithTheCounters() {
        GenerationRun run = run(7, RunStatus.RUNNING);

        store.append(7, "SNAPSHOT", "info", "Snapshotting assets", 0, 0, 0);
        store.append(7, "RENDER", "info", "Rendering pages", 0, 0, 0);
        assertThat(store.read(run).lines()).extracting(RunLogStore.Line::n).containsExactly(1, 2);
        assertThat(store.read(run).complete()).isFalse();
        assertThat(run.getLogBlobSha()).as("stored at the stage change already").isNotNull();

        store.append(7, "REPORT", "warning", "PARTIAL", 12, 1, 3);
        store.finish(7);

        RunLogStore.Log log = store.read(run);
        assertThat(log.complete()).isTrue();
        assertThat(log.truncated()).isFalse();
        assertThat(log.pruned()).isFalse();
        assertThat(log.lines()).extracting(RunLogStore.Line::stage).containsExactly("SNAPSHOT", "RENDER", "REPORT");
        RunLogStore.Line last = log.lines().get(2);
        assertThat(last.level()).isEqualTo("warning");
        assertThat(last.files()).isEqualTo(12);
        assertThat(last.errors()).isEqualTo(1);
        assertThat(last.warnings()).isEqualTo(3);
        assertThat(log.after(1).lines()).extracting(RunLogStore.Line::n).containsExactly(2, 3);
        assertThat(log.after(3).lines()).isEmpty();
    }

    @Test
    void aNodeThatDidNotExecuteTheRunContinuesTheStoredLog() {
        GenerationRun run = run(8, RunStatus.RUNNING);
        store.append(8, "SNAPSHOT", "info", "Snapshotting assets", 0, 0, 0);
        store.finish(8);
        assertThat(store.live(8)).isEmpty();

        // The executor's node is gone (nothing is held in memory); a cancel elsewhere appends to the log of the stored lines.
        store.append(8, "REPORT", "warning", "CANCELLED", 0, 0, 0);
        store.finish(8);

        assertThat(store.read(run).lines()).extracting(RunLogStore.Line::n).containsExactly(1, 2);
        assertThat(store.read(run).lines().get(1).text()).isEqualTo("CANCELLED");
    }

    @Test
    void theCapKeepsOneMarkerAndTheClosingReport() {
        properties.setLogMaxLines(5);
        GenerationRun run = run(9, RunStatus.RUNNING);

        for (int i = 0; i < 20; i++) {
            store.append(9, "RENDER", "info", "line " + i, 0, 0, 0);
        }
        store.append(9, "REPORT", "info", "SUCCESS", 1, 0, 0);
        store.finish(9);

        RunLogStore.Log log = store.read(run);
        assertThat(log.truncated()).isTrue();
        assertThat(log.lines()).hasSize(6);
        assertThat(log.lines().get(4).text()).startsWith("Log truncated");
        assertThat(log.lines().get(4).level()).isEqualTo("warning");
        assertThat(log.lines().get(5).stage()).isEqualTo("REPORT");
        assertThat(log.lines()).extracting(RunLogStore.Line::n).containsExactly(1, 2, 3, 4, 5, 6);
    }

    @Test
    void aLongLineIsCut() {
        GenerationRun run = run(10, RunStatus.RUNNING);
        store.append(10, "RENDER", "info", "x".repeat(5000), 0, 0, 0);
        store.finish(10);
        assertThat(store.read(run).lines().get(0).text()).hasSize(RunLogStore.MAX_TEXT).endsWith("…");
    }

    @Test
    void aFinishedRunWithoutAStoredLogReadsAsPrunedAndAnActiveOneAsEmpty() {
        RunLogStore.Log finished = store.read(run(11, RunStatus.SUCCESS));
        assertThat(finished.pruned()).isTrue();
        assertThat(finished.complete()).isTrue();
        assertThat(finished.lines()).isEmpty();

        RunLogStore.Log queued = store.read(run(12, RunStatus.QUEUED));
        assertThat(queued.pruned()).isFalse();
        assertThat(queued.complete()).isFalse();
        assertThat(queued.lines()).isEmpty();
    }

    @Test
    void aBlobThatIsGoneReadsAsPruned() {
        GenerationRun run = run(13, RunStatus.FAILED);
        run.setLogBlobSha("f".repeat(64));
        assertThat(store.read(run).pruned()).isTrue();
    }
}
