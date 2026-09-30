package com.acme.staticforge.preferences;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.user.AppUserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The signed-in user's preferences (M35.3): one JSON object per account, versioned by {@code schemaVersion}, capped
 * at {@value #MAX_BYTES} bytes serialized ({@code 413 SF-DOM-0133}). A body that isn't a JSON object, or carries a
 * {@code schemaVersion} that isn't a positive integer or is newer than {@value #CURRENT_SCHEMA_VERSION}, is
 * {@code 422 SF-DOM-0134}.
 *
 * <p>Writes run under a row lock on the account, so two tabs patching disjoint keys at once never lose each other's
 * keys. The document is neither exported nor revisioned.
 */
@Service
public class UserPreferencesService {

    public static final int MAX_BYTES = 64 * 1024;
    public static final int CURRENT_SCHEMA_VERSION = 1;
    public static final String SCHEMA_VERSION = "schemaVersion";

    private final UserPreferencesRepository repository;
    private final AppUserRepository users;
    private final ObjectMapper objectMapper;

    public UserPreferencesService(
            UserPreferencesRepository repository, AppUserRepository users, ObjectMapper objectMapper) {
        this.repository = repository;
        this.users = users;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public JsonNode get(Long userId) {
        return repository.findById(userId).map(UserPreferences::getDocument).orElseGet(this::defaults);
    }

    /** Replaces the document; {@code schemaVersion} defaults to the current version. */
    @Transactional
    public JsonNode replace(Long userId, JsonNode document) {
        ObjectNode next = requireObject(document).deepCopy();
        lockAccount(userId);
        return store(userId, next);
    }

    /** Applies an RFC 7386 JSON merge patch onto the stored document and returns the merged document. */
    @Transactional
    public JsonNode patch(Long userId, JsonNode mergePatch) {
        requireObject(mergePatch);
        lockAccount(userId);
        ObjectNode merged = repository
                .findById(userId)
                .map(UserPreferences::getDocument)
                .filter(JsonNode::isObject)
                .map(d -> (ObjectNode) d.deepCopy())
                .orElseGet(this::defaults);
        apply(merged, mergePatch);
        return store(userId, merged);
    }

    @Transactional
    public void deleteFor(Long userId) {
        repository.deleteByUserId(userId);
    }

    private void lockAccount(Long userId) {
        users.lockById(userId).orElseThrow(() -> new SfException(ProblemFactory.notFound("User " + userId)));
    }

    private JsonNode store(Long userId, ObjectNode document) {
        normalizeAndValidate(document);
        if (document.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new SfException(ProblemFactory.other(
                    413,
                    "SF-DOM-0133",
                    "Payload Too Large",
                    "The preferences document is larger than " + MAX_BYTES + " bytes; drop some entries."));
        }
        Instant now = Instant.now();
        UserPreferences row = repository.findById(userId).orElse(null);
        if (row == null) {
            row = new UserPreferences(userId, document, now);
        } else {
            row.replace(document, now);
        }
        repository.save(row);
        return document;
    }

    private ObjectNode defaults() {
        return objectMapper.createObjectNode().put(SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
    }

    private static JsonNode requireObject(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw invalid("The preferences document must be a JSON object.");
        }
        return body;
    }

    /** {@code schemaVersion} defaults to the current version; otherwise it must be a known positive integer. */
    private static void normalizeAndValidate(ObjectNode document) {
        JsonNode version = document.get(SCHEMA_VERSION);
        if (version == null || version.isNull()) {
            document.put(SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
            return;
        }
        if (!version.isIntegralNumber() || !version.canConvertToInt() || version.intValue() < 1) {
            throw invalid("schemaVersion must be a positive integer.");
        }
        if (version.intValue() > CURRENT_SCHEMA_VERSION) {
            throw invalid("schemaVersion " + version.intValue() + " is newer than the supported version "
                    + CURRENT_SCHEMA_VERSION + ".");
        }
    }

    /** RFC 7386: null removes a key, objects merge recursively, everything else replaces. */
    private static void apply(ObjectNode target, JsonNode patch) {
        Iterator<Map.Entry<String, JsonNode>> fields = patch.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            JsonNode value = field.getValue();
            if (value.isNull()) {
                target.remove(field.getKey());
            } else if (value.isObject()) {
                JsonNode existing = target.get(field.getKey());
                ObjectNode child = existing != null && existing.isObject()
                        ? (ObjectNode) existing
                        : target.putObject(field.getKey());
                apply(child, value);
            } else {
                target.set(field.getKey(), value.deepCopy());
            }
        }
    }

    private static SfException invalid(String detail) {
        return new SfException(ProblemFactory.other(422, "SF-DOM-0134", "Unprocessable Entity", detail));
    }
}
