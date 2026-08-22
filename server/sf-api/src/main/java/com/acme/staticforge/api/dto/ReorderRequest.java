package com.acme.staticforge.api.dto;

import java.util.List;

/** Section reorder request body. */
public record ReorderRequest(List<String> instanceIds) {}
