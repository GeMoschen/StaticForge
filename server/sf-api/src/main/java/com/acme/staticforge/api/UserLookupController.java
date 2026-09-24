package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.UserLookupHit;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Member lookup for project admins (M26.1.2): find an existing account to add to a project. Only a
 * {@code PROJECT_ADMIN} of {@code projectKey} (or an instance admin) may ask; hits are at most {@value #LIMIT}
 * active or locked accounts, flagged when already a member, and never carry an email.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserLookupController {

    static final int LIMIT = 20;

    private final UserService userService;
    private final ProjectService projectService;

    public UserLookupController(UserService userService, ProjectService projectService) {
        this.userService = userService;
        this.projectService = projectService;
    }

    @GetMapping("/lookup")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public List<UserLookupHit> lookup(
            @RequestParam("projectKey") String projectKey, @RequestParam(required = false) String q) {
        Set<Long> memberIds = projectService.members(projectKey).stream()
                .map(ProjectMember::getUserId)
                .collect(Collectors.toSet());
        return userService.lookup(q, LIMIT).stream()
                .map(u -> new UserLookupHit(u.getId(), u.getUsername(), u.getDisplayName(), memberIds.contains(u.getId())))
                .toList();
    }
}
