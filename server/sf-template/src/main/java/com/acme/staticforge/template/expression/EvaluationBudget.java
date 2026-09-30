package com.acme.staticforge.template.expression;

import java.time.Duration;

/**
 * Bounds an evaluation (M33.1): a number of interpreter steps and a wall-clock deadline, shared by every expression
 * evaluated against it — the rule engine uses one budget per definition. Exceeding either raises
 * {@link ExpressionError}. Not thread-safe; one budget per evaluation run.
 */
public final class EvaluationBudget {

    /** Default step limit per budget. */
    public static final long DEFAULT_STEPS = 200_000;

    /** Default time limit per budget (epic decision 4: 200 ms per definition). */
    public static final Duration DEFAULT_TIMEOUT = Duration.ofMillis(200);

    private final long maxSteps;
    private final long deadlineNanos;
    private long steps;

    public EvaluationBudget(long maxSteps, Duration timeout) {
        this.maxSteps = maxSteps;
        this.deadlineNanos = System.nanoTime() + timeout.toNanos();
    }

    /** A budget with the default limits, starting now. */
    public static EvaluationBudget standard() {
        return new EvaluationBudget(DEFAULT_STEPS, DEFAULT_TIMEOUT);
    }

    /** Counts {@code n} steps; checks the deadline every 1,024 steps. */
    public void tick(long n) {
        long before = steps;
        steps += n;
        if (steps > maxSteps) {
            throw new ExpressionError("Evaluation limit exceeded (" + maxSteps + " steps)");
        }
        if ((before >>> 10) != (steps >>> 10) && System.nanoTime() > deadlineNanos) {
            throw new ExpressionError("Evaluation time limit exceeded");
        }
    }

    /** Steps used so far. */
    public long steps() {
        return steps;
    }
}
