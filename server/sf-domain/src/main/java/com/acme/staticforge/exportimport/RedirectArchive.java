package com.acme.staticforge.exportimport;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectPaths;
import com.acme.staticforge.redirect.RedirectRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Component;

/**
 * The redirect registry of a full-project export archive (M30.4.1, protocol {@code 10}): {@code redirects.json}, every
 * {@code AUTO} and {@code MANUAL} redirect with its page target kept as an asset uuid. Selective exports carry none.
 *
 * <p>The import adds each redirect whose source path is free in the target; one whose channel, locale and source path
 * already redirect there is left out with {@link ConflictType#REDIRECT_SOURCE_EXISTS}, one that doesn't fit the target
 * (unknown channel or locale, a malformed path) with {@link ConflictType#REDIRECT_INVALID}. Neither blocks the import.
 */
@Component
class RedirectArchive {

    /** The index file name normalization would append; archive paths are normalized, so it never applies. */
    private static final String INDEX = "index.html";

    private final RedirectRepository redirects;
    private final UserService users;
    private final Clock clock;

    RedirectArchive(RedirectRepository redirects, UserService users, Clock clock) {
        this.redirects = redirects;
        this.users = users;
        this.clock = clock;
    }

    /** Every redirect of the project, sorted by channel, locale and source path. */
    List<ExportedRedirect> export(long projectId) {
        List<RedirectEntry> entries = redirects.findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(projectId);
        Map<Long, Optional<String>> usernames = new HashMap<>();
        List<ExportedRedirect> out = new ArrayList<>();
        for (RedirectEntry entry : entries) {
            String createdBy = entry.getCreatedBy() == null
                    ? null
                    : usernames.computeIfAbsent(entry.getCreatedBy(), id -> users.findById(id)
                            .filter(user -> user.getStatus() != UserStatus.DELETED)
                            .map(AppUser::getUsername))
                            .orElse(null);
            out.add(new ExportedRedirect(
                    entry.getChannelKey(),
                    entry.getLocaleKey(),
                    entry.getFromPath(),
                    entry.getToAssetUuid() == null ? null : entry.getToAssetUuid().toString(),
                    entry.getToPageNumber(),
                    entry.getToPath(),
                    entry.getKind().name(),
                    entry.getCreatedAt(),
                    createdBy));
        }
        return out;
    }

    /**
     * The analysis warnings of the archive's redirects against the target as the import will leave it: {@code channels}
     * are the channel keys it will have, {@code locales} its languages.
     */
    List<ImportConflict> analyze(long projectId, List<ExportedRedirect> archived, Set<String> channels, LocaleConfig locales) {
        List<ImportConflict> conflicts = new ArrayList<>();
        walk(projectId, archived, channels, locales, (redirect, normalized) -> {}, conflicts);
        return conflicts;
    }

    /** What an import did with the archive's redirects. */
    record Result(int imported, List<ImportConflict> warnings) {}

    /**
     * Adds the archive's redirects to the target, after its assets and settings, in the import's transaction.
     * {@code assetUuid} maps an archive asset uuid to the target's (the import re-keys an asset only on a collision).
     */
    Result importAll(
            long projectId, List<ExportedRedirect> archived, Set<String> channels, LocaleConfig locales,
            Function<String, UUID> assetUuid) {
        List<ImportConflict> warnings = new ArrayList<>();
        Instant now = clock.instant();
        int[] imported = {0};
        walk(projectId, archived, channels, locales, (redirect, normalized) -> {
            RedirectKind kind = RedirectKind.valueOf(redirect.kind());
            Long createdBy = kind == RedirectKind.MANUAL ? userId(redirect.createdByUsername()) : null;
            RedirectEntry entry = new RedirectEntry(projectId, normalized.channel(), normalized.locale(),
                    normalized.fromPath(), kind, redirect.createdAt() == null ? now : redirect.createdAt(), createdBy);
            if (normalized.toPath() != null) {
                entry.targetPath(normalized.toPath());
            } else {
                entry.targetAsset(assetUuid.apply(redirect.toAssetUuid()), normalized.toPageNumber());
            }
            entry.touched(now, createdBy);
            redirects.save(entry);
            imported[0]++;
        }, warnings);
        redirects.flush();
        return new Result(imported[0], warnings);
    }

    /** A redirect as the target stores it. */
    private record Normalized(String channel, String locale, String fromPath, Integer toPageNumber, String toPath) {}

    private interface Accept {
        void accept(ExportedRedirect redirect, Normalized normalized);
    }

    /** Hands every importable redirect to {@code accept} and reports each one left out in {@code conflicts}. */
    private void walk(
            long projectId, List<ExportedRedirect> archived, Set<String> channels, LocaleConfig locales, Accept accept,
            List<ImportConflict> conflicts) {
        Set<String> seen = new HashSet<>();
        for (ExportedRedirect redirect : archived) {
            Normalized normalized;
            try {
                normalized = normalize(redirect, channels, locales);
            } catch (Invalid invalid) {
                conflicts.add(ImportConflict.of(ConflictType.REDIRECT_INVALID, null, redirect.label(),
                        "Not imported: " + invalid.getMessage()));
                continue;
            }
            String key = normalized.channel() + "\u0000" + normalized.locale() + "\u0000" + normalized.fromPath();
            if (!seen.add(key)) {
                conflicts.add(ImportConflict.of(ConflictType.REDIRECT_SOURCE_EXISTS, null, redirect.label(),
                        "Not imported: the archive redirects this path twice; the first one is kept."));
                continue;
            }
            if (redirects.findByProjectIdAndChannelKeyAndLocaleKeyAndFromPath(
                    projectId, normalized.channel(), normalized.locale(), normalized.fromPath()).isPresent()) {
                conflicts.add(ImportConflict.of(ConflictType.REDIRECT_SOURCE_EXISTS, null, redirect.label(),
                        "Not imported: this project already redirects '" + normalized.fromPath() + "'; its redirect is kept."));
                continue;
            }
            accept.accept(redirect, normalized);
        }
    }

    private static Normalized normalize(ExportedRedirect redirect, Set<String> channels, LocaleConfig locales) {
        if (redirect.channel() == null || !channels.contains(redirect.channel())) {
            throw new Invalid("channel '" + redirect.channel() + "' doesn't exist in this project.");
        }
        String locale = redirect.locale() == null ? "" : redirect.locale();
        if (locales.isLocalized()) {
            String declared = locales.canonicalDeclared(locale);
            if (declared == null) {
                throw new Invalid(locale.isEmpty()
                        ? "it has no language, and this project has languages."
                        : "language '" + locale + "' doesn't exist in this project.");
            }
            locale = declared;
        } else if (!locale.isEmpty()) {
            throw new Invalid("it is for language '" + locale + "', and this project has no languages.");
        }
        RedirectKind kind = Arrays.stream(RedirectKind.values())
                .filter(k -> k.name().equals(redirect.kind()))
                .findFirst()
                .orElseThrow(() -> new Invalid("unknown kind '" + redirect.kind() + "'."));
        boolean page = redirect.toAssetUuid() != null;
        if (page == (redirect.toPath() != null)) {
            throw new Invalid("it needs exactly one target, a page or a path.");
        }
        try {
            String fromPath = RedirectPaths.source(redirect.fromPath(), INDEX, "fromPath");
            if (!fromPath.equals(redirect.fromPath())) {
                throw new Invalid("'" + redirect.fromPath() + "' is not a normalized output path.");
            }
            if (page) {
                UUID.fromString(redirect.toAssetUuid());
                int number = redirect.toPageNumber() == null ? 1 : redirect.toPageNumber();
                if (number < 1) {
                    throw new Invalid("page number " + number + " is not valid.");
                }
                return new Normalized(redirect.channel(), locale, fromPath, number, null);
            }
            if (kind == RedirectKind.AUTO) {
                throw new Invalid("an automatic redirect always points at a page.");
            }
            String toPath = RedirectPaths.target(redirect.toPath(), INDEX, "toPath");
            if (fromPath.equals(RedirectPaths.pathOf(toPath))) {
                throw new Invalid("it redirects '" + fromPath + "' to itself.");
            }
            return new Normalized(redirect.channel(), locale, fromPath, null, toPath);
        } catch (SfException e) {
            throw new Invalid(e.getProblem().getDetail());
        } catch (IllegalArgumentException e) {
            throw new Invalid("'" + redirect.toAssetUuid() + "' is not an asset uuid.");
        }
    }

    /** The user with {@code username}, whatever their status (a creator is history); {@code null} when unknown. */
    private Long userId(String username) {
        if (username == null || username.toLowerCase(Locale.ROOT).startsWith(UserService.DELETED_USERNAME_PREFIX)) {
            return null;
        }
        return users.findByUsername(username).map(AppUser::getId).orElse(null);
    }

    /** Why a redirect of the archive doesn't fit the target. */
    private static final class Invalid extends RuntimeException {

        Invalid(String message) {
            super(message, null, false, false);
        }
    }
}
