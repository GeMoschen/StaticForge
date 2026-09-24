package com.acme.staticforge.project;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import org.springframework.stereotype.Component;

/**
 * An archived project is read-only (M26, epic decision 12): every write answers {@code 409 SF-DOM-0141}.
 *
 * <p>The central check sits in {@code RevisionService.allocate}, so every write that allocates a revision is covered
 * without its own guard. Writes that allocate none (starting or promoting a generation run, creating a preview share
 * link, a search reindex, …) call {@link #requireWritable} themselves. Archive and unarchive, and the anonymizing
 * delete of an account, bypass the check on purpose.
 */
@Component
public class ProjectWriteGuard {

    public static final String ARCHIVED_CODE = "SF-DOM-0141";

    private final ProjectRepository projects;

    public ProjectWriteGuard(ProjectRepository projects) {
        this.projects = projects;
    }

    /** Throws {@code 409 SF-DOM-0141} when the project is archived; an unknown id is left to the caller. */
    public void requireWritable(long projectId) {
        if (projects.findArchivedById(projectId).orElse(false)) {
            throw archived();
        }
    }

    /** Throws {@code 409 SF-DOM-0141} when the project is archived. */
    public void requireWritable(Project project) {
        if (project.isArchived()) {
            throw archived();
        }
    }

    public static SfException archived() {
        return new SfException(ProblemFactory.other(
                409, ARCHIVED_CODE, "Project is archived", "The project is archived and can't be changed."));
    }
}
