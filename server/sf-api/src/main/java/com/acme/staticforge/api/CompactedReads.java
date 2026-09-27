package com.acme.staticforge.api;

import com.acme.staticforge.revision.compaction.CompactedHistory;
import java.util.Collection;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * The compacted notice of point-in-time reads (M29.4.3, epic decision 13): a read at {@code ?revision=R} whose asset
 * shows compacted history (the exact state at {@code R} was absorbed into a later version of the day) answers with
 * {@code X-SF-Compacted: true}. {@code AssetDetailView} (the time-travel read of any asset) and the diff carry the flag
 * in the body instead; the typed detail views, the record grid and the page preview carry this header. A read at the
 * current revision never pays more than one lookup of {@code project.compacted_through}.
 */
@Component
class CompactedReads {

    /** Present, with value {@code true}, only on a compacted read. */
    static final String HEADER = "X-SF-Compacted";

    private final CompactedHistory history;

    CompactedReads(CompactedHistory history) {
        this.history = history;
    }

    /** Whether a read of {@code uuid} at {@code revision} ({@code null} = current) is compacted. */
    boolean compacted(long projectId, UUID uuid, Long revision) {
        return history.assetCompactedAt(projectId, uuid, revision);
    }

    /** {@code response} with {@value #HEADER} when a read of {@code uuid} at {@code revision} is compacted. */
    <T> ResponseEntity<T> mark(ResponseEntity<T> response, long projectId, UUID uuid, Long revision) {
        return compacted(projectId, uuid, revision) ? withHeader(response) : response;
    }

    /** {@code response} with {@value #HEADER} when a read of any of {@code uuids} at {@code revision} is compacted. */
    <T> ResponseEntity<T> markAny(ResponseEntity<T> response, long projectId, Collection<UUID> uuids, Long revision) {
        return history.anyCompactedAt(projectId, uuids, revision) ? withHeader(response) : response;
    }

    /** {@code response} with {@value #HEADER} when the project's snapshot at {@code revision} holds compacted history. */
    <T> ResponseEntity<T> markSnapshot(ResponseEntity<T> response, long projectId, long revision) {
        return history.snapshotCompactedAt(projectId, revision) ? withHeader(response) : response;
    }

    private static <T> ResponseEntity<T> withHeader(ResponseEntity<T> response) {
        HttpHeaders headers = new HttpHeaders();
        headers.putAll(response.getHeaders());
        headers.set(HEADER, "true");
        return ResponseEntity.status(response.getStatusCode()).headers(headers).body(response.getBody());
    }
}
