package com.acme.staticforge.housekeeping.search;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchProblems;
import com.acme.staticforge.search.SearchStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Job {@code search-maintenance} (M29.3.3, epic decision 12): keeps every non-archived project's search index honest
 * between restarts. Per project:
 *
 * <ol>
 *   <li><b>Sync</b>: request a sync and wait until it is done (bounded), which catches up revisions whose
 *       after-commit indexing event was lost;
 *   <li><b>Count check</b>: the index's live documents against the indexable current versions
 *       ({@link SearchIndexer#counts}, the rebuild's own predicate). On a mismatch the index is rebuilt and the
 *       project reported {@code repaired};
 *   <li><b>Merge</b>: when deleted documents exceed {@code mergeDeletesPct} of the index, {@code forceMergeDeletes}
 *       (not a full merge).
 * </ol>
 *
 * A project whose rebuild is already running ({@code SF-SEARCH-0409}) is {@code SKIPPED}; one whose index is
 * unavailable ({@code SF-SEARCH-0503}) is reported and the run ends {@code PARTIAL}; the job goes on with the next
 * project either way. It never touches Lucene itself.
 */
@Component
public class SearchMaintenanceJob implements HousekeepingJob {

    public static final String KEY = "search-maintenance";

    /** How long one project's sync or rebuild may take before the job reports a timeout and moves on. */
    static final Duration WAIT = Duration.ofMinutes(10);

    static final SettingsSpec SETTINGS = SettingsSpec.builder().integer("mergeDeletesPct", 1, 100).build();

    private final SearchMaintenanceProperties properties;
    private final ProjectRepository projects;
    private final SearchIndexer indexer;

    public SearchMaintenanceJob(SearchMaintenanceProperties properties, ProjectRepository projects, SearchIndexer indexer) {
        this.properties = properties;
        this.projects = projects;
        this.indexer = indexer;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Search maintenance";
    }

    @Override
    public String description() {
        return "Catches up every project's search index, rebuilds it when its document count is off, and merges away"
                + " deleted documents.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings.put("mergeDeletesPct", properties.getMergeDeletesPct()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    /** What happened to one project. */
    enum Result {
        OK,
        REPAIRED,
        SKIPPED,
        UNAVAILABLE,
        TIMEOUT
    }

    @Override
    public JobResult run(JobContext ctx) throws InterruptedException {
        int mergeDeletesPct = ctx.settings().intValue("mergeDeletesPct");
        List<Project> active = ctx.inTransaction(() -> projects.findAll().stream()
                .filter(project -> !project.isArchived())
                .sorted(Comparator.comparing(Project::getId))
                .toList());
        ObjectNode byProject = ctx.report().putObject("projects");
        int repaired = 0;
        int merged = 0;
        int skipped = 0;
        int problems = 0;
        int n = 0;
        for (Project project : active) {
            ctx.checkCancelled();
            ctx.progress("Project " + (++n) + " of " + active.size() + ": " + project.getKey());
            ObjectNode entry = byProject.putObject(project.getKey());
            Result result = maintain(project.getId(), mergeDeletesPct, entry);
            entry.put("result", result.name());
            ctx.examined(1);
            switch (result) {
                case REPAIRED -> repaired++;
                case SKIPPED -> skipped++;
                case UNAVAILABLE, TIMEOUT -> problems++;
                case OK -> { }
            }
            if (entry.path("merged").asBoolean(false)) {
                merged++;
            }
            if (result == Result.REPAIRED || entry.path("merged").asBoolean(false)
                    || entry.path("lagBefore").asLong(0) > 0) {
                ctx.affected(1);
            }
        }
        ctx.report().put("archivedSkipped", ctx.inTransaction(() -> projects.findAll().stream()
                .filter(Project::isArchived)
                .count()));
        String message = active.size() + " projects: " + repaired + " repaired, " + merged + " merged, " + skipped
                + " skipped (rebuild running)" + (problems > 0 ? ", " + problems + " unavailable or timed out" : "") + ".";
        return problems > 0 ? JobResult.partial(message) : JobResult.succeeded(message);
    }

    private Result maintain(long projectId, int mergeDeletesPct, ObjectNode entry) throws InterruptedException {
        long started = System.nanoTime();
        try {
            SearchStatus before = indexer.status(projectId);
            entry.put("lagBefore", before.lag());
            if (before.state() == SearchStatus.State.UNAVAILABLE) {
                entry.put("code", SearchProblems.UNAVAILABLE);
                return Result.UNAVAILABLE;
            }
            if (before.state() == SearchStatus.State.REBUILDING) {
                entry.put("code", SearchProblems.CONFLICT);
                return Result.SKIPPED;
            }
            if (!indexer.syncAndAwait(projectId, WAIT)) {
                return Result.TIMEOUT;
            }
            entry.put("lagAfter", indexer.status(projectId).lag());
            Optional<SearchIndexer.IndexCounts> counts = indexer.counts(projectId);
            if (counts.isEmpty()) {
                return Result.OK; // archived or deleted meanwhile
            }
            SearchIndexer.IndexCounts count = counts.get();
            entry.put("indexable", count.indexable());
            entry.put("documents", count.documents());
            entry.put("deleted", count.deleted());
            Result result = Result.OK;
            if (count.indexable() != count.documents()) {
                if (!indexer.requestRebuild(projectId)) {
                    entry.put("code", SearchProblems.CONFLICT);
                    return Result.SKIPPED;
                }
                if (!indexer.awaitProject(projectId, WAIT)) {
                    return Result.TIMEOUT;
                }
                result = Result.REPAIRED;
                count = indexer.counts(projectId).orElse(count);
                entry.put("documentsAfter", count.documents());
            }
            boolean merge = count.deletedPercent() > mergeDeletesPct;
            if (merge) {
                indexer.forceMergeDeletes(projectId);
            }
            entry.put("merged", merge);
            return result;
        } catch (SfException e) {
            Object code = e.getProblem().getExtensions().get("code");
            if (SearchProblems.UNAVAILABLE.equals(code)) {
                entry.put("code", SearchProblems.UNAVAILABLE);
                return Result.UNAVAILABLE;
            }
            throw e;
        } finally {
            entry.put("durationMs", Duration.ofNanos(System.nanoTime() - started).toMillis());
        }
    }
}
