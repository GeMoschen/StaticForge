package com.acme.staticforge.exportimport;

import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.TargetLocations;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Decides, per archived generation target, what a settings import does with it. Shared by conflict
 * analysis and the import itself so the report always describes exactly what import will do.
 *
 * <p>A target whose name already exists is skipped (import only adds). A target whose
 * {@code config.path} is invalid, or whose output folder would coincide with / nest in an existing
 * target's or an earlier imported target's folder, is imported <em>without</em> its path: it then
 * falls back to {@code target-{id}}, which can never clash (see {@link TargetLocations}).
 */
final class TargetImportPlan {

    enum Action {
        SKIP_NAME_COLLISION,
        IMPORT,
        IMPORT_WITHOUT_PATH
    }

    /**
     * @param config the config to store (the archived one, or a copy without {@code path})
     * @param reason why the path was dropped; {@code null} unless {@link Action#IMPORT_WITHOUT_PATH}
     */
    record Decision(ExportedGenerationTarget source, Action action, JsonNode config, String reason) {}

    private record Occupied(String path, String targetName) {}

    private TargetImportPlan() {}

    static List<Decision> plan(List<GenerationTarget> existing, List<ExportedGenerationTarget> archived) {
        Set<String> existingNames = existing.stream().map(GenerationTarget::getName).collect(Collectors.toSet());
        List<Occupied> occupied = new ArrayList<>();
        for (GenerationTarget target : existing) {
            try {
                occupied.add(new Occupied(TargetLocations.relativePath(target), target.getName()));
            } catch (IllegalArgumentException invalidExistingPath) {
                // An already-stored invalid path fails generation on its own; nothing to reserve.
            }
        }

        List<Decision> decisions = new ArrayList<>();
        for (ExportedGenerationTarget t : archived) {
            if (existingNames.contains(t.name())) {
                decisions.add(new Decision(t, Action.SKIP_NAME_COLLISION, t.config(), null));
                continue;
            }
            Optional<String> path;
            try {
                path = TargetLocations.configuredPath(t.config());
            } catch (IllegalArgumentException invalid) {
                decisions.add(withoutPath(t, "its output folder is invalid (" + invalid.getMessage() + ")"));
                continue;
            }
            if (path.isEmpty()) {
                decisions.add(new Decision(t, Action.IMPORT, t.config(), null));
                continue;
            }
            Optional<Occupied> clash = occupied.stream()
                    .filter(o -> TargetLocations.overlaps(path.get(), o.path()))
                    .findFirst();
            if (clash.isPresent()) {
                decisions.add(withoutPath(t, "its output folder '" + path.get()
                        + "' overlaps the output of target '" + clash.get().targetName() + "'"));
                continue;
            }
            occupied.add(new Occupied(path.get(), t.name()));
            decisions.add(new Decision(t, Action.IMPORT, t.config(), null));
        }
        return decisions;
    }

    private static Decision withoutPath(ExportedGenerationTarget t, String reason) {
        ObjectNode config = ((ObjectNode) t.config()).deepCopy();
        config.remove(TargetLocations.PATH_KEY);
        return new Decision(t, Action.IMPORT_WITHOUT_PATH, config, reason);
    }
}
