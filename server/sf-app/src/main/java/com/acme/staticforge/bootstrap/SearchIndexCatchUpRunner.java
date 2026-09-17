package com.acme.staticforge.bootstrap;

import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.search.SearchIndexer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Brings every active project's search index up to date at startup (M23.2.2): a missing, unreadable or outdated index
 * is rebuilt, a lagging one replays the revisions it missed (for example after the app stopped between a commit and
 * its indexing). Only requests the syncs; they run in the background, so readiness never waits for indexing.
 */
@Component
public class SearchIndexCatchUpRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SearchIndexCatchUpRunner.class);

    private final ProjectRepository projects;
    private final SearchIndexer indexer;

    public SearchIndexCatchUpRunner(ProjectRepository projects, SearchIndexer indexer) {
        this.projects = projects;
        this.indexer = indexer;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            projects.findAll().stream()
                    .filter(project -> !project.isArchived())
                    .map(Project::getId)
                    .forEach(indexer::requestSync);
        } catch (RuntimeException e) {
            // Search is derived data: never block startup on it.
            log.warn("Could not schedule the search index catch-up", e);
        }
    }
}
