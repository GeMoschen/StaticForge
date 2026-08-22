package com.acme.staticforge.common;

/**
 * Base class for the StaticForge exception hierarchy. Carries a RFC 9457 {@link Problem}
 * so the API layer can translate any domain/service exception into a consistent
 * {@code application/problem+json} response.
 */
public class SfException extends RuntimeException {

    private final Problem problem;

    public SfException(Problem problem) {
        super(problem.getTitle());
        this.problem = problem;
    }

    public SfException(Problem problem, String message) {
        super(message);
        this.problem = problem;
    }

    public SfException(Problem problem, String message, Throwable cause) {
        super(message, cause);
        this.problem = problem;
    }

    public Problem getProblem() {
        return problem;
    }

    public int getStatus() {
        return problem.getStatus() != null ? problem.getStatus() : 500;
    }
}
