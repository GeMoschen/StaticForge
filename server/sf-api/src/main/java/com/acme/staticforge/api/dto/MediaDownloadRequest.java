package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * Request body for {@code POST /media/download}: the files to put in one ZIP (in this order) and the name of the archive
 * without its extension (the folder's name; {@code media} when left out).
 */
public record MediaDownloadRequest(List<UUID> uuids, String name) {}
