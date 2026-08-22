package com.acme.staticforge.revision;

import java.util.List;
import java.util.UUID;

/** The diff of one touched asset between two revisions. */
public record AssetDiff(UUID uuid, String uid, String type, String action, List<FieldChange> changes) {}
