package com.acme.staticforge.scheduler;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Every {@link ScheduledActionHandler} bean by its {@link ScheduledActionHandler#type()} (M27.4.1). */
@Component
public class ScheduledActionHandlers {

    private final Map<String, ScheduledActionHandler> byType = new LinkedHashMap<>();

    public ScheduledActionHandlers(List<ScheduledActionHandler> handlers) {
        for (ScheduledActionHandler handler : handlers) {
            ScheduledActionHandler previous = byType.put(handler.type(), handler);
            if (previous != null) {
                throw new IllegalStateException("Two handlers for action type " + handler.type() + ": "
                        + previous.getClass().getName() + ", " + handler.getClass().getName());
            }
        }
    }

    public Optional<ScheduledActionHandler> find(String type) {
        return Optional.ofNullable(type == null ? null : byType.get(type));
    }

    /** The handler of {@code type}; {@code 422 SF-DOM-0160} when there is none. */
    public ScheduledActionHandler require(String type) {
        return find(type).orElseThrow(() -> SchedulerProblems.unknownType(type));
    }

    public Collection<String> types() {
        return byType.keySet();
    }
}
