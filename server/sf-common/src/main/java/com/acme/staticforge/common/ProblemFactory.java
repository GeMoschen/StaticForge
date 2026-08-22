package com.acme.staticforge.common;

/**
 * Factory for the problem documents defined in the StaticForge error catalogue
 * (spec Appendix B). Centralizing construction keeps the {@code type} URIs and
 * {@code code} values consistent across the API layer.
 */
public final class ProblemFactory {

    private static final String PROBLEMS_BASE = "https://cms.example.com/problems/";

    private ProblemFactory() {}

    public static Problem of(int status, String code, String title, String detail) {
        return Problem.builder()
                .type(PROBLEMS_BASE + code.toLowerCase().replace('_', '-'))
                .title(title)
                .status(status)
                .detail(detail)
                .property("code", code)
                .build();
    }

    public static Problem badRequest(String detail) {
        return of(400, "SF-API-0400", "Bad Request", detail);
    }

    public static Problem unauthorized(String detail) {
        return of(401, "SF-API-0401", "Unauthorized", detail);
    }

    public static Problem forbidden(String detail) {
        return of(403, "SF-API-0403", "Forbidden", detail);
    }

    public static Problem notFound(String detail) {
        return of(404, "SF-API-0404", "Not Found", detail);
    }

    public static Problem conflict(String detail) {
        return of(409, "SF-API-0409", "Conflict", detail);
    }

    public static Problem unprocessableEntity(String detail) {
        return of(422, "SF-API-0422", "Validation Failed", detail);
    }

    public static Problem other(int status, String code, String title, String detail) {
        return Problem.builder()
                .type(PROBLEMS_BASE + code.toLowerCase().replace('_', '-'))
                .title(title)
                .status(status)
                .detail(detail)
                .property("code", code)
                .build();
    }
}
