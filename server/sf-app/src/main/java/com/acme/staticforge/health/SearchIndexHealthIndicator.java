package com.acme.staticforge.health;

import com.acme.staticforge.search.SearchIndexService;
import com.acme.staticforge.search.SearchProperties;
import java.util.Locale;
import java.util.Set;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Search index health (M23.2.2). Search is derived data, so an unavailable index (its write lock held by another
 * instance) is reported as a {@code DEGRADED} detail while the component stays {@code UP}: the CMS works without
 * search, and failing the health check would restart an otherwise healthy instance.
 */
@Component
public class SearchIndexHealthIndicator implements HealthIndicator {

    private final SearchIndexService index;
    private final SearchProperties properties;

    public SearchIndexHealthIndicator(SearchIndexService index, SearchProperties properties) {
        this.index = index;
        this.properties = properties;
    }

    @Override
    public Health health() {
        Set<Long> unavailable = index.unavailableProjects();
        return Health.up()
                .withDetail("search", unavailable.isEmpty() ? "AVAILABLE" : "DEGRADED")
                .withDetail("directory", properties.directory().name().toLowerCase(Locale.ROOT))
                .withDetail("openIndexes", index.openProjects().size())
                .withDetail("unavailableProjects", unavailable)
                .build();
    }
}
