package com.acme.staticforge.api.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/** Update-project request body (spec §20.2). {@code allowedMimeTypes} fully replaces the project's override; null/empty clears it back to the instance-wide default. */
public record ProjectUpdateRequest(@NotBlank String name, String description, List<String> allowedMimeTypes) {}
