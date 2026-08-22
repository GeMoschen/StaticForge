package com.acme.staticforge.project;

import java.util.List;
import java.util.Optional;

/**
 * Project domain service (spec §8.1, §8.3). Owns project lifecycle and membership. Every
 * mutating method allocates a {@link com.acme.staticforge.revision.Revision} so no write
 * path bypasses revisioning (spec §21.2).
 */
public interface ProjectService {

    /**
     * Creates a project, initializes its revision counter at 1, allocates revision 1
     * ({@code CREATE}), and grants the acting user {@code PROJECT_ADMIN}. Returns the saved
     * project.
     */
    Project create(CreateProjectRequest cmd, Long actingUserId);

    Optional<Project> findByKey(String key);

    /** Returns the project or throws a 404 problem when absent. */
    Project requireByKey(String key);

    /** All projects ordered by key (used by INSTANCE_ADMIN listing). */
    List<Project> listAll();

    /** {@code allowedMimeTypes} is always fully replaced; an empty/null list clears the override back to the instance-wide default. */
    Project update(String key, String name, String description, List<String> allowedMimeTypes, Long actingUserId, String comment);

    void archive(String key, Long actingUserId, String comment);

    List<ProjectMember> members(String key);

    /** Upserts a membership and records an {@code UPDATE} revision + summary entry. */
    void setMemberRole(String key, Long userId, ProjectRole role, Long actingUserId, String comment);

    /** Removes a membership and records an {@code UPDATE} revision + summary entry. */
    void removeMember(String key, Long userId, Long actingUserId, String comment);

    List<ProjectMember> membershipsOf(Long userId);
}
