package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CdlValidateRequest;
import com.acme.staticforge.api.dto.CdlValidateResponse;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.cdl.DatasetCdlRules;
import com.acme.staticforge.template.cdl.GlobalSetCdlRules;
import com.acme.staticforge.template.cdl.PaginationCdlRules;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * CDL validation endpoint (spec §14.7, §20.2). Compiles arbitrary CDL and returns positioned
 * diagnostics so Monaco can render squiggles while typing; template saves re-run the same
 * compiler server-side.
 *
 * <p>{@code kind=GLOBAL_SET} additionally applies the property-set restrictions (M17.2.1), so the
 * Globals schema editor gets exactly the diagnostics its save will enforce. {@code kind=DATASET}
 * does the same for dataset schemas (M19.2.1), and {@code kind=SECTION_TEMPLATE} for section templates (M21.1.1:
 * no pagination editor). A second endpoint
 * would have meant a second place for the two to drift apart.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/cdl")
public class CdlValidateController {

    private static final String GLOBAL_SET_KIND = "GLOBAL_SET";

    private static final String DATASET_KIND = "DATASET";

    private static final String SECTION_TEMPLATE_KIND = "SECTION_TEMPLATE";

    private final CdlCompiler cdlCompiler = new CdlCompiler();

    @PostMapping(value = "/validate", produces = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public CdlValidateResponse validate(
            @PathVariable("projectKey") String projectKey,
            @RequestParam(value = "kind", required = false) String kind,
            @RequestBody CdlValidateRequest body) {
        CdlResult result = cdlCompiler.compile(body.source());
        String requested = kind == null ? "" : kind.trim();
        List<Diagnostic> diagnostics = new ArrayList<>(result.diagnostics());
        if (GLOBAL_SET_KIND.equalsIgnoreCase(requested)) {
            diagnostics.addAll(GlobalSetCdlRules.check(result.definition()));
        } else if (DATASET_KIND.equalsIgnoreCase(requested)) {
            diagnostics.addAll(DatasetCdlRules.check(result.definition()));
        } else if (SECTION_TEMPLATE_KIND.equalsIgnoreCase(requested)) {
            diagnostics.addAll(PaginationCdlRules.notAllowedIn(result.definition(), "a section template"));
        }
        return new CdlValidateResponse(diagnostics);
    }
}
