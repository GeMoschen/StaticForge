package com.acme.staticforge.template.render;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * The guard-rail budget of one top-level render and every render nested inside it (spec §16.10,
 * §26.3): body sections, {@code $CMS_INCLUDE}d sections and catalog cards. The pipelines render
 * those through separate {@link Renderer#render} calls; passing one budget down through each
 * nested {@link RenderContext} makes the limits apply to the whole page instead of restarting at
 * every level:
 *
 * <ul>
 *   <li>nesting depth — more than {@value #MAX_INCLUDE_DEPTH} levels of nested templates below the
 *       top-level one fails with {@code SF-TPL-0130};
 *   <li>cycles — a template already being rendered further up the chain fails with
 *       {@code SF-TPL-0135} (checked before the depth limit, so A → B → A is reported as a cycle);
 *   <li>loop iterations ({@code SF-TPL-0131}), output size ({@code SF-TPL-0132}) and wall-clock
 *       time ({@code SF-TPL-0133}) — aggregated across all nested renders.
 * </ul>
 *
 * <p>Mutable and not thread-safe: a budget belongs to exactly one top-level render and the
 * nested renders it triggers, which all run on the same thread. Never share one across
 * {@code RenderPipeline} entries or concurrent previews.
 */
public final class RenderBudget {

    /** Maximum nesting levels below the top-level template (which is itself the first stack entry). */
    public static final int MAX_INCLUDE_DEPTH = 32;

    static final int MAX_LOOP_ITERATIONS = 100_000;
    static final int MAX_OUTPUT_CHARS = 32 * 1024 * 1024;
    static final long TIME_BUDGET_NANOS = 5_000_000_000L;

    private final long deadlineNanos;
    private final Deque<Frame> stack = new ArrayDeque<>();
    private int loopIterations;
    private long outputChars;

    /** Starts a budget; the time budget runs from now. */
    public RenderBudget() {
        this.deadlineNanos = System.nanoTime() + TIME_BUDGET_NANOS;
    }

    /**
     * Runs {@code render} with {@code templateUuid} pushed onto the nesting stack, popping it
     * afterwards (also when the render throws).
     *
     * @param templateUuid the template about to be rendered
     * @param label a human-readable name for diagnostics (typically the template UID)
     * @throws RenderLimitException {@code SF-TPL-0135} when the template is already being rendered
     *     further up the chain, {@code SF-TPL-0130} when nesting would exceed the depth limit
     */
    public <T> T withTemplate(UUID templateUuid, String label, Supplier<T> render) {
        enter(templateUuid, label);
        try {
            return render.get();
        } finally {
            stack.pop();
        }
    }

    private void enter(UUID templateUuid, String label) {
        String name = label == null || label.isBlank() ? String.valueOf(templateUuid) : label;
        for (Frame frame : stack) {
            if (frame.templateUuid.equals(templateUuid)) {
                throw new RenderLimitException(Diagnostic.error(
                        DiagnosticCodes.OCTL_INCLUDE_CYCLE, "Include cycle: " + chainFrom(templateUuid) + " → " + name, 0, 0));
            }
        }
        if (stack.size() > MAX_INCLUDE_DEPTH) {
            throw new RenderLimitException(Diagnostic.error(
                    DiagnosticCodes.OCTL_INCLUDE_DEPTH,
                    "Include depth exceeded (" + MAX_INCLUDE_DEPTH + " levels) at " + name, 0, 0));
        }
        stack.push(new Frame(templateUuid, name));
    }

    /** The stack from the first occurrence of {@code templateUuid} to the innermost template, outermost first. */
    private String chainFrom(UUID templateUuid) {
        StringBuilder chain = new StringBuilder();
        boolean started = false;
        for (Iterator<Frame> it = stack.descendingIterator(); it.hasNext(); ) {
            Frame frame = it.next();
            started |= frame.templateUuid.equals(templateUuid);
            if (started) {
                chain.append(chain.isEmpty() ? "" : " → ").append(frame.label);
            }
        }
        return chain.toString();
    }

    void countLoopIteration(int line, int col) {
        if (++loopIterations > MAX_LOOP_ITERATIONS) {
            throw new RenderLimitException(Diagnostic.error(
                    DiagnosticCodes.OCTL_LOOP_LIMIT, "Loop iteration limit exceeded", line, col));
        }
    }

    /** The output characters charged so far, across all nested renders. */
    long outputChars() {
        return outputChars;
    }

    void chargeOutput(long chars) {
        outputChars += chars;
        if (outputChars > MAX_OUTPUT_CHARS) {
            throw new RenderLimitException(Diagnostic.error(
                    DiagnosticCodes.OCTL_OUTPUT_LIMIT, "Output size limit exceeded (32 MB)", 0, 0));
        }
    }

    void checkTime() {
        if (System.nanoTime() - deadlineNanos > 0) {
            throw new RenderLimitException(Diagnostic.error(
                    DiagnosticCodes.OCTL_TIME_BUDGET, "Render time budget exceeded (5 s)", 0, 0));
        }
    }

    private record Frame(UUID templateUuid, String label) {}
}
