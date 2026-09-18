package com.acme.staticforge.project;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

/**
 * Reads a project's {@link LocaleConfig} by numeric id — the one place the stored JSON column
 * is decoded. Validation, rendering, generation, search and export all resolve locales
 * through this, so none of them needs a {@link ProjectService} dependency (which would make
 * the bean graph circular).
 *
 * <p>Deliberately uncached: the configuration is read once per save or per generation run,
 * changes are rare, and a stale cache would silently render the wrong locales.
 */
@Component
public class ProjectLocales {

    private final ProjectRepository projectRepository;
    private final ObjectMapper objectMapper;

    public ProjectLocales(ProjectRepository projectRepository, ObjectMapper objectMapper) {
        this.projectRepository = projectRepository;
        this.objectMapper = objectMapper;
    }

    /** The project's locale configuration, {@link LocaleConfig#EMPTY} when it has none. */
    public LocaleConfig forProject(long projectId) {
        return projectRepository.findById(projectId).map(this::decode).orElse(LocaleConfig.EMPTY);
    }

    /** Decodes a project's stored configuration. */
    public LocaleConfig decode(Project project) {
        return decode(project.getLocaleConfig(), objectMapper);
    }

    /** Decodes a stored {@code locale_config} JSON node; {@code null}/non-object means "no locales". */
    public static LocaleConfig decode(JsonNode node, ObjectMapper objectMapper) {
        if (node == null || node.isNull() || !node.isObject()) {
            return LocaleConfig.EMPTY;
        }
        try {
            return objectMapper.treeToValue(node, LocaleConfig.class);
        } catch (JsonProcessingException e) {
            throw new SfException(
                    ProblemFactory.other(
                            500, "SF-API-0500", "Internal Server Error", "Stored locale configuration is unreadable."),
                    e.getMessage(),
                    e);
        }
    }
}
