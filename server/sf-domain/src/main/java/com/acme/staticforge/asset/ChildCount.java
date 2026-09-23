package com.acme.staticforge.asset;

/** How many live children of one type a container holds (M25: records per record set), projected from a grouped query. */
public record ChildCount(Long folderId, long count) {}
