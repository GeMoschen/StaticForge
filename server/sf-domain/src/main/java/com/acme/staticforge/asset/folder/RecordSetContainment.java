package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;

/**
 * The record set containment rules (M25, epic decisions 2 and 7) — the one place every write path
 * asks whether an asset may sit in a parent: {@code AssetServiceImpl} for create, move and restore,
 * {@code FolderServiceImpl} for folders, and import for archived placements.
 *
 * <ul>
 *   <li>a {@code RECORD}'s parent is always a live {@code RECORD_SET} whose {@code datasetRef} equals the
 *       record's — never the Content store root, never a Content folder;</li>
 *   <li>a {@code RECORD_SET}'s parent is a {@code FOLDER} (the Content scope itself is the
 *       {@link FolderScope} rule), never another set;</li>
 *   <li>a {@code RECORD_SET} holds records only: no folders, no sets, no other asset types.</li>
 * </ul>
 *
 * <p>The rules are pure: callers pass what they know about child and parent (from the database or
 * from an archive), so the same verdict can reject a write or become an import conflict.
 * A violation is {@code 422 SF-DOM-0104}, the {@code FolderScope} violation shape with its own code.
 */
public final class RecordSetContainment {

    /** The problem code of a containment violation. */
    public static final String CODE = "SF-DOM-0104";

    private RecordSetContainment() {}

    /**
     * The rule {@code childType} placed in the parent breaks, as a user-facing sentence, or empty.
     *
     * @param childPayload the child's payload (a record's {@code datasetRef} is read from it)
     * @param parentType the parent's type; a store root (no explicit parent) is a {@code FOLDER}
     * @param parentPayload the parent's payload ({@code null} for a store root)
     * @param parentDeleted whether the parent's current version is soft-deleted
     */
    public static Optional<String> violation(
            AssetType childType, JsonNode childPayload, AssetType parentType, JsonNode parentPayload, boolean parentDeleted) {
        if (childType == AssetType.RECORD) {
            if (parentType != AssetType.RECORD_SET) {
                return Optional.of("A record always lives in a record set — it can't be placed directly in the Content"
                        + " store or in a folder.");
            }
            if (parentDeleted) {
                return Optional.of("The record set has been deleted — restore it (with its records) first.");
            }
            String recordDataset = datasetRef(childPayload);
            if (recordDataset == null || !Objects.equals(recordDataset, datasetRef(parentPayload))) {
                return Optional.of("This record set holds records of another dataset — a record only moves between"
                        + " sets of its own dataset.");
            }
            return Optional.empty();
        }
        if (parentType == AssetType.RECORD_SET) {
            return Optional.of(childType == AssetType.RECORD_SET
                    ? "A record set can't be placed inside another record set."
                    : "A record set holds records only — " + childType.name().toLowerCase(Locale.ROOT)
                            + " assets can't be placed in it.");
        }
        return Optional.empty();
    }

    /** Throws {@link #error} when {@link #violation} finds one. */
    public static void require(
            AssetType childType, JsonNode childPayload, AssetType parentType, JsonNode parentPayload, boolean parentDeleted) {
        violation(childType, childPayload, parentType, parentPayload, parentDeleted).ifPresent(detail -> {
            throw error(detail);
        });
    }

    /** The {@code 422 SF-DOM-0104} problem for a containment violation. */
    public static SfException error(String detail) {
        return new SfException(ProblemFactory.other(422, CODE, "Validation Failed", detail));
    }

    /**
     * {@code 409 SF-DOM-0110} for deleting a record set that still has live records, with {@code recordCount}:
     * the folder "not empty" conflict, since a set follows folder delete semantics (epic decision 7).
     */
    public static SfException notEmpty(long records) {
        return new SfException(Problem.builder()
                .type("https://cms.example.com/problems/sf-dom-0110")
                .title("Conflict")
                .status(409)
                .detail("Record set still has " + records + " record" + (records == 1 ? "" : "s")
                        + ". Delete them first, or delete the set together with its records.")
                .property("code", "SF-DOM-0110")
                .property("recordCount", records)
                .build());
    }

    /** A payload's {@code datasetRef}, lower-cased for comparison, or {@code null} when absent. */
    private static String datasetRef(JsonNode payload) {
        JsonNode ref = payload == null ? null : payload.get("datasetRef");
        return ref != null && ref.isTextual() && !ref.asText().isBlank()
                ? ref.asText().trim().toLowerCase(Locale.ROOT)
                : null;
    }
}
