package com.acme.staticforge.api.dto;

import java.util.UUID;

/** A {@code NAVIGATION}-scoped folder's detail view, including its {@code startNode}. */
public record NavigationFolderView(
        UUID uuid, String uid, String displayName, long revision, String folderPath, NavigationStartNodeView startNode) {}
