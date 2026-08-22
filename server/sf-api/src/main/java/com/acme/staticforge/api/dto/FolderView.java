package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/** A folder node in the tree view. */
public record FolderView(UUID uuid, String uid, String displayName, String path, List<FolderView> children) {}
