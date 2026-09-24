package com.acme.staticforge.api;

import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.acme.staticforge.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.Set;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Answers every mutating request to an archived project with {@code 409 SF-DOM-0141} before the request body is
 * even read (M26, epic decision 12), so the caller learns the project is read-only rather than hearing about a
 * validation error first. Handlers marked {@link AllowedOnArchivedProject} pass.
 *
 * <p>This is the early, uniform answer. The domain enforces the same rule on its own ({@code RevisionService.allocate}
 * and {@link ProjectWriteGuard}), for callers that don't come through the API.
 *
 * <p>Only a caller who can reach the project gets the {@code 409}: for anyone else the request goes on to the usual
 * {@code 404} of {@code @projectAuth}, so an archived project's existence stays hidden. Members never can: their
 * tokens leave archived projects out.
 */
@Component
public class ArchivedProjectInterceptor implements HandlerInterceptor {

    private static final Set<String> MUTATING = Set.of("POST", "PUT", "PATCH", "DELETE");

    private final ProjectRepository projects;

    public ArchivedProjectInterceptor(ProjectRepository projects) {
        this.projects = projects;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!MUTATING.contains(request.getMethod())
                || !(handler instanceof HandlerMethod method)
                || method.hasMethodAnnotation(AllowedOnArchivedProject.class)) {
            return true;
        }
        String key = projectKey(request);
        if (key == null || !canReach(key)) {
            return true;
        }
        if (projects.findByKey(key).map(Project::isArchived).orElse(false)) {
            throw ProjectWriteGuard.archived();
        }
        return true;
    }

    /** {@code /api/v1/projects/{key}/…} names it {@code key} in the project controller, {@code projectKey} elsewhere. */
    private static String projectKey(HttpServletRequest request) {
        if (!request.getRequestURI().startsWith(request.getContextPath() + "/api/v1/projects/")) {
            return null;
        }
        @SuppressWarnings("unchecked")
        Map<String, String> variables =
                (Map<String, String>) request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        if (variables == null) {
            return null;
        }
        return variables.getOrDefault("projectKey", variables.get("key"));
    }

    private static boolean canReach(String key) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AuthenticatedUser user)) {
            return false;
        }
        return user.isInstanceAdmin() || (user.projectRoles() != null && user.projectRoles().containsKey(key));
    }
}
