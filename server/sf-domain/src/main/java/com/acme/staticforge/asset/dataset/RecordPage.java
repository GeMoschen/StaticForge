package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One page of a record listing (M19.2.1): lightweight rows and the total the query matched. A row
 * carries only the record's scalar editor values ({@code text}, {@code number}, {@code date}, …),
 * never lists, rich text or references, so a page of 50 stays small whatever the records hold.
 */
public record RecordPage(List<Row> rows, long totalElements, int page, int size) {

    public int totalPages() {
        return size <= 0 ? 0 : (int) ((totalElements + size - 1) / size);
    }

    /** @param folderPath Content-store relative ({@code /team/}) */
    public record Row(
            UUID uuid, String uid, String displayName, String folderPath, Instant changedAt, Long changedBy, JsonNode values) {}
}
