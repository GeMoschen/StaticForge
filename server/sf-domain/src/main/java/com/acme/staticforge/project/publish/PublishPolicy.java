package com.acme.staticforge.project.publish;

import com.acme.staticforge.project.ProjectRole;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * A project's publish policy (M28, epic decisions 1–3): the {@link PublishPermission}s its editors hold. Stored as
 * {@code project.publish_policy} ({@code {"editor": [...]}}); every project starts with none.
 *
 * <p>{@link #grants} is <em>the</em> rule — the request-side check (role from the token) and the scheduler's check
 * (role from the membership row) both call it, so they can't disagree.
 */
public record PublishPolicy(Set<PublishPermission> editor) {

    /** Nothing opened to editors: the state of every project until an admin opts in. */
    public static final PublishPolicy EMPTY = new PublishPolicy(Set.of());

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    public PublishPolicy {
        EnumSet<PublishPermission> copy = EnumSet.noneOf(PublishPermission.class);
        if (editor != null) {
            copy.addAll(editor);
        }
        editor = Collections.unmodifiableSet(copy);
    }

    public static PublishPolicy of(PublishPermission... editor) {
        return new PublishPolicy(Set.of(editor));
    }

    /**
     * The policy named by {@code names}; throws {@link InvalidPolicyException} listing every unknown name. Duplicates
     * collapse.
     */
    public static PublishPolicy parse(Collection<String> names) {
        EnumSet<PublishPermission> permissions = EnumSet.noneOf(PublishPermission.class);
        List<String> errors = new ArrayList<>();
        for (String name : names == null ? List.<String>of() : names) {
            PublishPermission.byName(name).ifPresentOrElse(
                    permissions::add, () -> errors.add("Unknown publish permission '" + name + "'."));
        }
        if (!errors.isEmpty()) {
            throw new InvalidPolicyException(errors);
        }
        return new PublishPolicy(permissions);
    }

    /** The stored column; {@code null}, a missing list or unknown names (never written) read as nothing granted. */
    public static PublishPolicy fromJson(JsonNode node) {
        EnumSet<PublishPermission> permissions = EnumSet.noneOf(PublishPermission.class);
        if (node != null && node.path("editor").isArray()) {
            node.path("editor").forEach(n -> PublishPermission.byName(n.asText()).ifPresent(permissions::add));
        }
        return new PublishPolicy(permissions);
    }

    public ObjectNode toJson() {
        ObjectNode node = JSON.objectNode();
        ArrayNode list = node.putArray("editor");
        editor.forEach(p -> list.add(p.name()));
        return node;
    }

    /** Whether {@code role} holds {@code permission} under this policy. */
    public boolean grants(ProjectRole role, PublishPermission permission) {
        return switch (role) {
            case VIEWER -> false;
            case EDITOR -> editor.contains(permission);
            case DEVELOPER, PROJECT_ADMIN -> true;
        };
    }

    /** Every permission {@code role} holds, in declaration order. */
    public Set<PublishPermission> effective(ProjectRole role) {
        EnumSet<PublishPermission> held = EnumSet.noneOf(PublishPermission.class);
        for (PublishPermission permission : PublishPermission.values()) {
            if (grants(role, permission)) {
                held.add(permission);
            }
        }
        return Collections.unmodifiableSet(held);
    }

    /** One message per broken implication (epic decision 3); empty when the policy may be stored. */
    public List<String> validate() {
        List<String> errors = new ArrayList<>();
        if (editor.contains(PublishPermission.SCHEDULE_RELEASE) && !editor.contains(PublishPermission.RELEASE)) {
            errors.add("SCHEDULE_RELEASE requires RELEASE: editors who schedule a release must be allowed to release.");
        }
        if (editor.contains(PublishPermission.FULL_BUILD) && !editor.contains(PublishPermission.INCREMENTAL_BUILD)) {
            errors.add("FULL_BUILD requires INCREMENTAL_BUILD: editors who start full builds must be allowed to start "
                    + "incremental ones.");
        }
        return errors;
    }

    /** A policy that names unknown permissions or breaks an implication; {@link #errors()} has one message each. */
    public static final class InvalidPolicyException extends RuntimeException {

        private final List<String> errors;

        public InvalidPolicyException(List<String> errors) {
            super(String.join(" ", errors));
            this.errors = List.copyOf(errors);
        }

        public List<String> errors() {
            return errors;
        }
    }
}
