package com.acme.staticforge.user;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** User account management (spec §8.2). */
@Service
public class UserService {

    /** Prefix of an anonymized account's username (M26); reserved so a rename can never collide with one. */
    public static final String DELETED_USERNAME_PREFIX = "deleted-user-";

    /** Domain of an anonymized account's email (M26); reserved for the same reason. */
    public static final String DELETED_EMAIL_DOMAIN = "@invalid";

    private static final int USERNAME_MAX = 100;
    private static final int EMAIL_MAX = 255;
    private static final int DISPLAY_NAME_MAX = 200;
    private static final Pattern USERNAME = Pattern.compile("[\\p{L}\\p{N}._@+-]+");
    private static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+");

    private final AppUserRepository users;
    private final PasswordService passwords;
    private final PasswordPolicy passwordPolicy;
    private final AuditService auditService;

    public UserService(
            AppUserRepository users, PasswordService passwords, PasswordPolicy passwordPolicy, AuditService auditService) {
        this.users = users;
        this.passwords = passwords;
        this.passwordPolicy = passwordPolicy;
        this.auditService = auditService;
    }

    /** A profile edit with PATCH semantics: {@code null} leaves a field unchanged; a blank display name clears it. */
    public record ProfileUpdate(String username, String email, String displayName) {}

    /** {@code true} while the user table is empty (first start of a fresh instance). */
    @Transactional(readOnly = true)
    public boolean isEmpty() {
        return users.count() == 0;
    }

    @Transactional(readOnly = true)
    public Optional<AppUser> findByUsername(String username) {
        return users.findByUsername(username);
    }

    @Transactional(readOnly = true)
    public Optional<AppUser> findByEmail(String email) {
        return users.findByEmail(email);
    }

    @Transactional(readOnly = true)
    public Optional<AppUser> findById(Long id) {
        return users.findById(id);
    }

    /** The accounts with these ids, by id; unknown ids are absent. One query (listings that show many actors). */
    @Transactional(readOnly = true)
    public Map<Long, AppUser> findAllById(Collection<Long> ids) {
        return users.findAllById(ids).stream()
                .collect(Collectors.toMap(AppUser::getId, user -> user));
    }

    @Transactional(readOnly = true)
    public AppUser requireById(Long id) {
        return users.findById(id)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("User not found.")));
    }

    @Transactional
    public AppUser create(String username, String email, String displayName, String rawPassword) {
        if (users.findByUsername(username).isPresent()) {
            throw new SfException(ProblemFactory.conflict("Username already taken."));
        }
        if (users.findByEmail(email).isPresent()) {
            throw new SfException(ProblemFactory.conflict("Email already in use."));
        }
        AppUser user = new AppUser(username, email, Instant.now());
        user.setDisplayName(displayName);
        user.setPasswordHash(passwords.hash(rawPassword));
        return users.save(user);
    }

    /**
     * Creates an instance admin (spec §8.2) in the same revision-agnostic transaction. With {@code
     * mustChangePassword} the account can call nothing but the password-change allowlist until it sets a new one.
     */
    @Transactional
    public AppUser createInstanceAdmin(
            String username, String email, String displayName, String rawPassword, boolean mustChangePassword) {
        AppUser user = create(username, email, displayName, rawPassword);
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        user.setMustChangePassword(mustChangePassword);
        return user;
    }

    /**
     * Sets a new password the user chose. It must meet the {@link PasswordPolicy} ({@code 400 SF-API-0400} with
     * {@code errors} otherwise) and clears a pending forced change.
     */
    @Transactional
    public void changePassword(Long userId, String newRawPassword) {
        passwordPolicy.requireValid(newRawPassword);
        AppUser user = requireById(userId);
        user.setPasswordHash(passwords.hash(newRawPassword));
        user.setMustChangePassword(false);
        users.save(user);
    }

    /**
     * Revokes every access token issued to the user so far by bumping {@code tokenEpoch} (spec §9.2): the next
     * request with an older token is {@code 401}, and a refresh issues a token that reflects the current roles.
     * Called on every change of what the user may do — membership role set or removed, password change, and the
     * admin actions of M26.
     */
    @Transactional
    public void revokeAccess(Long userId) {
        AppUser user = requireById(userId);
        user.setTokenEpoch(user.getTokenEpoch() + 1);
        users.save(user);
    }

    /**
     * Applies a profile edit (M26: instance admin or the user themselves) and audits it with {@code actorUserId} as
     * actor: a username change as {@code USER_RENAMED} (old and new name), any other change as {@code USER_UPDATED}
     * (the names of the changed fields, not their values). The username and email must be well-formed, not reserved
     * for anonymized accounts and unique ignoring case ({@code 409}). Sessions stay valid: tokens name the user by id.
     *
     * @return the fields that actually changed, in the order username, email, displayName
     */
    @Transactional
    public List<String> updateProfile(Long userId, ProfileUpdate update, Long actorUserId) {
        AppUser user = requireById(userId);
        String oldUsername = user.getUsername();
        List<String> changed = new ArrayList<>();
        if (update.username() != null) {
            String username = requireUsableUsername(update.username(), userId);
            if (!username.equals(user.getUsername())) {
                user.setUsername(username);
                changed.add("username");
            }
        }
        if (update.email() != null) {
            String email = requireUsableEmail(update.email(), userId);
            if (!email.equals(user.getEmail())) {
                user.setEmail(email);
                changed.add("email");
            }
        }
        if (update.displayName() != null) {
            String displayName = normalizeDisplayName(update.displayName());
            if (!Objects.equals(displayName, user.getDisplayName())) {
                user.setDisplayName(displayName);
                changed.add("displayName");
            }
        }
        if (changed.isEmpty()) {
            return changed;
        }
        users.save(user);
        if (changed.contains("username")) {
            ObjectNode detail = userDetail(userId).put("from", oldUsername).put("to", user.getUsername());
            auditService.record(null, actorUserId, "USER_RENAMED", "user:" + user.getUsername(), detail);
        }
        List<String> others = changed.stream().filter(f -> !f.equals("username")).toList();
        if (!others.isEmpty()) {
            ObjectNode detail = userDetail(userId);
            others.forEach(detail.putArray("fields")::add);
            auditService.record(null, actorUserId, "USER_UPDATED", "user:" + user.getUsername(), detail);
        }
        return changed;
    }

    /**
     * The trimmed username when it is well-formed (1–100 letters, digits or {@code . _ @ + -}), not reserved and not
     * taken by another account ignoring case; {@code 400} or {@code 409} otherwise.
     */
    @Transactional(readOnly = true)
    public String requireUsableUsername(String raw, Long exceptUserId) {
        String username = raw == null ? "" : raw.trim();
        if (username.isEmpty()) {
            throw new SfException(ProblemFactory.badRequest("Username must not be blank.", "username"));
        }
        if (username.length() > USERNAME_MAX) {
            throw new SfException(
                    ProblemFactory.badRequest("Username must be at most " + USERNAME_MAX + " characters.", "username"));
        }
        if (!USERNAME.matcher(username).matches()) {
            throw new SfException(
                    ProblemFactory.badRequest("Username may only contain letters, digits and . _ @ + -", "username"));
        }
        if (username.toLowerCase(Locale.ROOT).startsWith(DELETED_USERNAME_PREFIX)) {
            throw new SfException(ProblemFactory.badRequest(
                    "Usernames starting with '" + DELETED_USERNAME_PREFIX + "' are reserved.", "username"));
        }
        users.findByUsernameIgnoreCase(username)
                .filter(other -> !other.getId().equals(exceptUserId))
                .ifPresent(other -> {
                    throw new SfException(ProblemFactory.conflict("Username already taken."));
                });
        return username;
    }

    /** The trimmed email when it is well-formed, not reserved and not used by another account ignoring case. */
    @Transactional(readOnly = true)
    public String requireUsableEmail(String raw, Long exceptUserId) {
        String email = raw == null ? "" : raw.trim();
        if (email.isEmpty()) {
            throw new SfException(ProblemFactory.badRequest("Email must not be blank.", "email"));
        }
        if (email.length() > EMAIL_MAX || !EMAIL.matcher(email).matches()) {
            throw new SfException(ProblemFactory.badRequest("Email is not a valid address.", "email"));
        }
        if (email.toLowerCase(Locale.ROOT).endsWith(DELETED_EMAIL_DOMAIN)) {
            throw new SfException(
                    ProblemFactory.badRequest("Addresses at '" + DELETED_EMAIL_DOMAIN + "' are reserved.", "email"));
        }
        users.findByEmailIgnoreCase(email)
                .filter(other -> !other.getId().equals(exceptUserId))
                .ifPresent(other -> {
                    throw new SfException(ProblemFactory.conflict("Email already in use."));
                });
        return email;
    }

    /** Trimmed display name, {@code null} when blank; {@code 400} past 200 characters. */
    public static String normalizeDisplayName(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String displayName = raw.trim();
        if (displayName.length() > DISPLAY_NAME_MAX) {
            throw new SfException(ProblemFactory.badRequest(
                    "Display name must be at most " + DISPLAY_NAME_MAX + " characters.", "displayName"));
        }
        return displayName;
    }

    /**
     * Accounts a project admin may add as members (M26 member lookup): {@code ACTIVE} or {@code LOCKED}, matching
     * {@code q} in username or display name ignoring case (all when blank), ordered by username, at most
     * {@code limit}. Deliberately not matched against email: the lookup must not reveal addresses.
     */
    @Transactional(readOnly = true)
    public List<AppUser> lookup(String q, int limit) {
        String needle = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        Specification<AppUser> spec = (root, query, cb) -> {
            Predicate assignable = root.get("status").in(UserStatus.ACTIVE, UserStatus.LOCKED);
            if (needle.isEmpty()) {
                return assignable;
            }
            String pattern = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            return cb.and(
                    assignable,
                    cb.or(
                            cb.like(cb.lower(root.get("username")), pattern, '\\'),
                            cb.like(cb.lower(cb.coalesce(root.get("displayName"), "")), pattern, '\\')));
        };
        return users.findAll(spec, PageRequest.of(0, limit, Sort.by("username"))).getContent();
    }

    /** The {@code detail} every instance-level user audit entry starts from: which account it is about. */
    public static ObjectNode userDetail(Long userId) {
        return JsonNodeFactory.instance.objectNode().put("userId", userId);
    }
}
