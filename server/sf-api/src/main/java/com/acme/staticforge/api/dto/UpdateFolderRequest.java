package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * {@code PATCH /folders/{uuid}} body (M31). Only the fields present in the JSON change: {@code "startPage": "<uuid>"}
 * sets a pages folder's start page, {@code "startPage": null} clears it, and leaving the key out keeps it. A mutable
 * bean rather than a record, because a record can't tell an explicit {@code null} from a missing key.
 */
public final class UpdateFolderRequest {

    private UUID startPage;
    private boolean startPageSet;

    @Schema(nullable = true, description = "The page that renders as the folder's index file; null clears it.")
    public UUID getStartPage() {
        return startPage;
    }

    public void setStartPage(UUID startPage) {
        this.startPage = startPage;
        this.startPageSet = true;
    }

    /** Whether the body names {@code startPage} at all ({@code null} included). */
    @JsonIgnore
    public boolean hasStartPage() {
        return startPageSet;
    }
}
