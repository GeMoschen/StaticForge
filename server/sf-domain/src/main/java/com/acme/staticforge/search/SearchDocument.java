package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.util.Objects;
import java.util.UUID;

/**
 * One asset as the search index stores it (M23.1.1). Built by a {@code SearchTextExtractor} from the asset's current
 * version; the index service knows nothing about payloads.
 *
 * @param templateUuid the page's template, a record's dataset; {@code null} for other types
 * @param revision the {@code validFromRevision} of the extracted version
 * @param title display name and uid
 * @param text prose that belongs to no particular language: indexed into every language field
 * @param textByLocale prose of a language-dependent value, keyed by language (M24.3.3): indexed into
 *     that language's field, so a German search stems German and an English one English
 * @param source code (CDL, OCTL, processed text media): indexed language-neutral only
 */
public record SearchDocument(
        UUID uuid,
        AssetType assetType,
        String uid,
        String displayName,
        String folderPath,
        UUID templateUuid,
        long revision,
        String title,
        String text,
        java.util.Map<String, String> textByLocale,
        String source) {

    public SearchDocument {
        Objects.requireNonNull(uuid, "uuid");
        Objects.requireNonNull(assetType, "assetType");
        uid = uid == null ? "" : uid;
        displayName = displayName == null ? "" : displayName;
        folderPath = folderPath == null ? "/" : folderPath;
        title = title == null ? "" : title;
        text = text == null ? "" : text;
        textByLocale = textByLocale == null ? java.util.Map.of() : java.util.Map.copyOf(textByLocale);
        source = source == null ? "" : source;
    }

    /** A document of a project without languages, or of an asset with no language-dependent text. */
    public SearchDocument(
            UUID uuid,
            AssetType assetType,
            String uid,
            String displayName,
            String folderPath,
            UUID templateUuid,
            long revision,
            String title,
            String text,
            String source) {
        this(uuid, assetType, uid, displayName, folderPath, templateUuid, revision, title, text, java.util.Map.of(), source);
    }

    /** Everything searchable as prose, language-dependent parts included — what snippets are cut from. */
    public String allText() {
        if (textByLocale.isEmpty()) {
            return text;
        }
        StringBuilder all = new StringBuilder(text);
        textByLocale.values().forEach(value -> {
            if (!value.isBlank()) {
                if (!all.isEmpty()) {
                    all.append('\n');
                }
                all.append(value);
            }
        });
        return all.toString();
    }

    /** The prose indexed into {@code text_<locale>}: the neutral text plus that language's own. */
    public String textFor(String locale) {
        String own = textByLocale.getOrDefault(locale, "");
        if (own.isBlank()) {
            return text;
        }
        return text.isBlank() ? own : text + "\n" + own;
    }
}
