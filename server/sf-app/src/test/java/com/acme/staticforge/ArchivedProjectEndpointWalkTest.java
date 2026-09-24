package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

import com.acme.staticforge.api.AllowedOnArchivedProject;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Endpoint walk of M26.2.1: every {@code POST}/{@code PUT}/{@code PATCH}/{@code DELETE} handler under
 * {@code /api/v1/projects/{key}} is called by an instance admin on an archived project and must answer
 * {@code 409 SF-DOM-0141}, writing nothing. The handlers that may run there are listed in {@link #ALLOWED} with the
 * reason each was admitted; a new {@link AllowedOnArchivedProject} handler fails this test until it is reviewed here.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ArchivedProjectEndpointWalkTest {

    /** Reviewed allowlist: {@code Controller#method} → why it may run on an archived project. */
    private static final Map<String, String> ALLOWED = Map.ofEntries(
            Map.entry("ProjectController#archive", "idempotent: archiving an archived project changes nothing"),
            Map.entry("ProjectController#unarchive", "the one admitted write: reverses the archiving"),
            Map.entry("GenerationController#plan", "dry run: plans a build, writes nothing"),
            Map.entry("GenerationController#cancel", "stops a run started before archiving; a run is not content"),
            Map.entry("CdlValidateController#validate", "validates a draft CDL, stores nothing"),
            Map.entry("OctlValidateController#validate", "validates a draft template, stores nothing"),
            Map.entry("MediaController#validateText", "validates a draft text medium, stores nothing"),
            Map.entry("PreviewController#previewSection", "renders a section preview, stores nothing"),
            Map.entry("RecordSetController#previewQuery", "evaluates a draft set query, stores nothing"),
            Map.entry("ProjectExportController#exportSelection", "builds an export archive, changes nothing"),
            Map.entry("ProjectImportController#analyzeImport", "read-only transaction: reports conflicts, imports nothing"));

    private static final Set<RequestMethod> MUTATING =
            Set.of(RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE);

    private static final Pattern PROJECT_PATH = Pattern.compile("^/api/v1/projects/\\{(key|projectKey)}/.*");
    private static final Pattern VARIABLE = Pattern.compile("\\{([^}/:]+)(?::[^}]*)?}");

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired ProjectService projectService;
    @Autowired RevisionRepository revisions;
    @Autowired JwtService jwtService;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    @Test
    void everyMutatingProjectEndpointRefusesAnArchivedProject() throws Exception {
        AppUser admin = userService.create(
                "walk-admin-" + UUID.randomUUID(), UUID.randomUUID() + "@example.com", "Walk admin", "secret-password");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        admin = users.save(admin);
        Project project = projectService.create(
                new CreateProjectRequest("walk_" + Math.abs(UUID.randomUUID().getMostSignificantBits() % 100000),
                        "Walk", null, null),
                admin.getId());
        projectService.archive(project.getKey(), RevisionContext.of(project.getId(), admin.getId(), null));
        int revisionsBefore = revisions.findByProjectIdOrderByRevisionIdDesc(project.getId()).size();
        String token = "Bearer " + jwtService.issueAccessToken(admin);

        Map<String, String> allowedFound = new TreeMap<>();
        List<String> walked = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : handlerMapping.getHandlerMethods().entrySet()) {
            RequestMappingInfo info = entry.getKey();
            HandlerMethod handler = entry.getValue();
            Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
            List<String> paths = info.getPatternValues().stream()
                    .filter(p -> PROJECT_PATH.matcher(p).matches())
                    .toList();
            if (paths.isEmpty() || methods.stream().noneMatch(MUTATING::contains)) {
                continue;
            }
            String name = handler.getBeanType().getSimpleName() + "#" + handler.getMethod().getName();
            AllowedOnArchivedProject allowed = handler.getMethodAnnotation(AllowedOnArchivedProject.class);
            if (allowed != null) {
                allowedFound.put(name, allowed.value());
                continue;
            }
            for (RequestMethod method : methods) {
                if (!MUTATING.contains(method)) {
                    continue;
                }
                for (String path : paths) {
                    String url = url(path, project.getKey());
                    MvcResult result = mvc.perform(build(method, url, info).header("Authorization", token))
                            .andReturn();
                    walked.add(method + " " + path);
                    String problem = describe(result, handler);
                    if (problem != null) {
                        failures.add(method + " " + path + " (" + name + "): " + problem);
                    }
                }
            }
        }

        assertThat(failures).as("mutating endpoints that don't refuse an archived project").isEmpty();
        assertThat(allowedFound.keySet())
                .as("handlers marked @AllowedOnArchivedProject must be reviewed in ALLOWED")
                .containsExactlyInAnyOrderElementsOf(ALLOWED.keySet());
        assertThat(walked).as("the walk reached the project API").hasSizeGreaterThan(60);
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(project.getId())).hasSize(revisionsBefore);
    }

    /** {@code null} when the request was refused as expected, else what went wrong. */
    private String describe(MvcResult result, HandlerMethod expected) throws Exception {
        if (!(result.getHandler() instanceof HandlerMethod served) || !served.getMethod().equals(expected.getMethod())) {
            return "routed to " + result.getHandler() + ", status " + result.getResponse().getStatus();
        }
        int status = result.getResponse().getStatus();
        String body = result.getResponse().getContentAsString();
        if (status != 409) {
            return "status " + status + " " + body;
        }
        JsonNode problem = objectMapper.readTree(body);
        return "SF-DOM-0141".equals(problem.path("code").asText()) ? null : "409 with " + body;
    }

    /** The project variable becomes the archived project; every other variable gets a value of the right shape. */
    private static String url(String pattern, String projectKey) {
        Matcher m = VARIABLE.matcher(pattern);
        StringBuilder out = new StringBuilder();
        boolean first = true;
        while (m.find()) {
            String name = m.group(1);
            String value;
            if (first) {
                value = projectKey;
            } else if (name.toLowerCase(java.util.Locale.ROOT).contains("uuid")) {
                value = UUID.randomUUID().toString();
            } else if (name.equals("id") || name.endsWith("Id")) {
                value = "1";
            } else {
                value = "x";
            }
            first = false;
            m.appendReplacement(out, Matcher.quoteReplacement(value));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** A request the handler's {@code consumes} condition accepts, with an empty body of that type. */
    private static MockHttpServletRequestBuilder build(RequestMethod method, String url, RequestMappingInfo info) {
        Set<MediaType> consumes = info.getConsumesCondition().getConsumableMediaTypes();
        if (consumes.stream().anyMatch(MediaType.MULTIPART_FORM_DATA::includes)) {
            return multipart(HttpMethod.valueOf(method.name()), url);
        }
        MediaType type = consumes.stream()
                .filter(t -> !t.isWildcardType() && !t.isWildcardSubtype())
                .findFirst()
                .orElse(MediaType.APPLICATION_JSON);
        byte[] body = MediaType.APPLICATION_JSON.isCompatibleWith(type) ? "{}".getBytes() : new byte[0];
        return request(HttpMethod.valueOf(method.name()), url).contentType(type).content(body);
    }
}
