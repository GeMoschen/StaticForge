package com.acme.staticforge.project;

import com.acme.staticforge.revision.RevisionRepository;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The instance admin's view of every project (M26, {@code GET /admin/projects}): its state, how many members it has
 * and when it last changed. Read-only; three queries whatever the number of projects.
 */
@Service
public class ProjectOverviewService {

    private final ProjectService projects;
    private final ProjectMemberRepository members;
    private final RevisionRepository revisions;

    public ProjectOverviewService(
            ProjectService projects, ProjectMemberRepository members, RevisionRepository revisions) {
        this.projects = projects;
        this.members = members;
        this.revisions = revisions;
    }

    /**
     * One project with its member count and its newest revision — {@code headRevision} and {@code lastChangeAt} are
     * {@code null} only for a project without any revision, which creation never leaves behind.
     */
    public record ProjectOverview(Project project, long memberCount, Long headRevision, Instant lastChangeAt) {}

    /**
     * Every project sorted by key. {@code q} matches key, name and description ignoring case; archived projects are
     * left out unless {@code includeArchived}.
     */
    @Transactional(readOnly = true)
    public List<ProjectOverview> overview(String q, boolean includeArchived) {
        Map<Long, Long> memberCounts = new HashMap<>();
        for (Object[] row : members.countByProject()) {
            memberCounts.put((Long) row[0], (Long) row[1]);
        }
        Map<Long, Object[]> heads = new HashMap<>();
        for (Object[] row : revisions.findHeads()) {
            heads.put((Long) row[0], row);
        }
        String needle = q == null || q.isBlank() ? null : q.trim().toLowerCase(Locale.ROOT);
        return projects.listAll().stream()
                .filter(p -> includeArchived || !p.isArchived())
                .filter(p -> needle == null || matches(p, needle))
                .map(p -> {
                    Object[] head = heads.get(p.getId());
                    return new ProjectOverview(
                            p,
                            memberCounts.getOrDefault(p.getId(), 0L),
                            head == null ? null : (Long) head[1],
                            head == null ? null : (Instant) head[2]);
                })
                .toList();
    }

    private static boolean matches(Project project, String needle) {
        return contains(project.getKey(), needle)
                || contains(project.getName(), needle)
                || contains(project.getDescription(), needle);
    }

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(needle);
    }
}
