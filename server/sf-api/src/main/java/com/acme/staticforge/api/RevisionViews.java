package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionSummaryEnricher;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Builds the client-facing {@link RevisionView}s: the author's display name and the item names and touched languages of
 * the summary, looked up for a whole listing at once (a constant number of statements, never one per row).
 */
@Component
public class RevisionViews {

    private final UserService userService;
    private final RevisionSummaryEnricher enricher;

    public RevisionViews(UserService userService, RevisionSummaryEnricher enricher) {
        this.userService = userService;
        this.enricher = enricher;
    }

    public List<RevisionView> of(long projectId, List<Revision> revisions) {
        Map<Long, JsonNode> summaries = enricher.enrich(projectId, revisions);
        Map<Long, String> names = displayNames(revisions.stream().map(Revision::getCreatedBy).toList());
        return revisions.stream()
                .map(r -> new RevisionView(
                        r.getProjectId(),
                        r.getRevisionId(),
                        r.getCreatedAt(),
                        r.getCreatedBy(),
                        r.getCreatedBy() == null ? null : names.get(r.getCreatedBy()),
                        r.getChangeType().name(),
                        r.getComment(),
                        summaries.get(r.getRevisionId()),
                        r.isCompacted()))
                .toList();
    }

    public RevisionView of(long projectId, Revision revision) {
        return of(projectId, List.of(revision)).get(0);
    }

    /**
     * Display names by user id; an unknown or deleted (anonymized) account is absent, so callers show no name for it.
     * One query however many ids.
     */
    public Map<Long, String> displayNames(Collection<Long> userIds) {
        Set<Long> ids = userIds.stream().filter(Objects::nonNull).collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        return userService.findAllById(ids).values().stream()
                .filter(u -> u.getStatus() != UserStatus.DELETED && u.getDisplayName() != null)
                .collect(Collectors.toMap(AppUser::getId, AppUser::getDisplayName));
    }
}
