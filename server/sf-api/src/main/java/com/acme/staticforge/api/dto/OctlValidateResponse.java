package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/** OCTL validation result: positioned diagnostics for editor squiggles. */
public record OctlValidateResponse(List<Diagnostic> diagnostics) {}
