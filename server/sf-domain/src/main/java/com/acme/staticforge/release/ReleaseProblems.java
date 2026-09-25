package com.acme.staticforge.release;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.util.List;
import java.util.Map;

/** The problem details of release requests and views (M27.1.2, M27.2.3, Appendix B {@code SF-DOM-0150}–{@code 0155}). */
public final class ReleaseProblems {

    private ReleaseProblems() {}

    public static SfException incomplete(List<Map<String, Object>> assets) {
        return problem("SF-DOM-0150", "Content incomplete: fill in the required fields before releasing.", "assets", assets);
    }

    static SfException unknownItem(String detail) {
        return problem("SF-DOM-0151", detail, null, null);
    }

    static SfException nothingReleased(String detail, List<Map<String, Object>> assets) {
        return problem("SF-DOM-0152", detail, "assets", assets);
    }

    static SfException emptySelection() {
        return problem("SF-DOM-0153", "Select at least one asset.", null, null);
    }

    static SfException foreignVersion(String detail) {
        return problem("SF-DOM-0154", detail, null, null);
    }

    /** {@code 404 SF-DOM-0155}: the published view of a page that exists but isn't released in the language. */
    public static SfException notPublished() {
        return new SfException(Problem.builder()
                .type("https://cms.example.com/problems/sf-dom-0155")
                .title("Not Published")
                .status(404)
                .detail("Not published in this locale.")
                .property("code", "SF-DOM-0155")
                .build());
    }

    private static SfException problem(String code, String detail, String name, Object value) {
        Problem.Builder builder = Problem.builder()
                .type("https://cms.example.com/problems/" + code.toLowerCase(java.util.Locale.ROOT))
                .title("Unprocessable Entity")
                .status(422)
                .detail(detail)
                .property("code", code);
        if (name != null) {
            builder.property(name, value);
        }
        return new SfException(builder.build());
    }
}
