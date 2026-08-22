package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/** A folder node in the tree view. {@code scope} is {@code PAGES} or {@code MEDIA} — the two stores' folder trees are entirely separate. */
public record FolderView(UUID uuid, String uid, String displayName, String path, String scope, List<FolderView> children) {}
