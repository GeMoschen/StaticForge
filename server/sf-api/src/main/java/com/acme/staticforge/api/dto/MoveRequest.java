package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Move request body (target parent folder, null for root). */
public record MoveRequest(UUID folderUuid) {}
