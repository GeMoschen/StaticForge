package com.acme.staticforge.asset.folder;

import java.util.List;
import java.util.UUID;

/** A folder node in the materialized tree. */
public record FolderNode(UUID uuid, String uid, String displayName, String path, FolderScope scope, List<FolderNode> children) {}
