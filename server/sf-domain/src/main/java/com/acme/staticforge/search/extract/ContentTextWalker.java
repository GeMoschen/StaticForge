package com.acme.staticforge.search.extract;

import com.acme.staticforge.common.HtmlText;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.SelectOption;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Walks stored content values by their editor definitions and collects their searchable text (M23.1.2):
 *
 * <ul>
 *   <li>{@code text}, {@code textarea}, {@code markdown}: the string; {@code richtext}: its HTML as plain text;
 *   <li>{@code select}/{@code multiselect}: the chosen options' labels;
 *   <li>{@code link}: its title;
 *   <li>{@code list}: each item with the item editors; {@code catalog}: each card with its section template's
 *       definition; {@code group}: its editors, stored at the same level;
 *   <li>everything else ({@code reference}, {@code media}, {@code json}, numbers, dates, colors, booleans,
 *       pagination) is skipped.
 * </ul>
 *
 * The definition drives the walk, so a stale value whose editor no longer exists is ignored. Content without a
 * definition (its template is gone) falls back to every string leaf.
 */
final class ContentTextWalker {

    private static final Logger log = LoggerFactory.getLogger(ContentTextWalker.class);

    /** Nesting deeper than this (lists in catalog cards in lists …) is not walked. */
    private static final int MAX_DEPTH = 16;

    /** Keys of structural values that are never text: identifiers, discriminators, formats. */
    private static final Set<String> STRUCTURAL_KEYS = Set.of(
            "uuid", "assetUuid", "instanceId", "templateRef", "datasetRef", "type", "kind", "assetType", "format",
            "target", "anchor", "url", "mimeType", "blobSha256", "channel", "direction", "key");

    private ContentTextWalker() {}

    /** Collects the text of {@code content} as declared by {@code definition}. */
    static void walk(JsonNode content, ContentDefinition definition, ExtractionContext context, TextBuilder out) {
        walk(content, definition, context, out, 0);
    }

    /** Collects every string leaf of {@code node}, for content whose definition is unavailable. */
    static void leaves(JsonNode node, TextBuilder out) {
        leaves(node, out, 0);
    }

    private static void walk(
            JsonNode content, ContentDefinition definition, ExtractionContext context, TextBuilder out, int depth) {
        if (content == null || !content.isObject() || depth > MAX_DEPTH) {
            return;
        }
        for (EditorDefinition editor : definition.editors()) {
            visit(editor, content, context, out, depth);
        }
    }

    private static void visit(
            EditorDefinition editor, JsonNode content, ExtractionContext context, TextBuilder out, int depth) {
        if (out.full()) {
            return;
        }
        if (editor.isGroup()) {
            editor.items().forEach(item -> visit(item, content, context, out, depth));
            return;
        }
        JsonNode value = content.get(editor.name());
        if (value == null || value.isNull()) {
            return;
        }
        switch (editor.type()) {
            case TEXT, TEXTAREA, MARKDOWN -> out.add(text(value));
            case RICHTEXT -> out.add(HtmlText.toPlainText(richText(value)));
            case SELECT -> out.add(label(editor, text(value)));
            case MULTISELECT -> {
                if (value.isArray()) {
                    value.forEach(option -> out.add(label(editor, text(option))));
                }
            }
            case LINK -> out.add(text(value.get("title")));
            case LIST -> {
                if (value.isArray()) {
                    ContentDefinition items = new ContentDefinition(editor.items(), List.of());
                    value.forEach(item -> walk(item, items, context, out, depth + 1));
                }
            }
            case CATALOG -> cards(value.get("cards"), context, out, depth);
            default -> {
                // reference, media, json, number, boolean, date, datetime, color, pagination: not text
            }
        }
    }

    private static void cards(JsonNode cards, ExtractionContext context, TextBuilder out, int depth) {
        if (cards == null || !cards.isArray()) {
            return;
        }
        for (JsonNode card : cards) {
            JsonNode cardContent = card.get("content");
            Optional<ContentDefinition> definition = uuid(card.get("templateRef")).flatMap(context::sectionTemplateDefinition);
            if (definition.isPresent()) {
                walk(cardContent, definition.get(), context, out, depth + 1);
            } else {
                log.debug("Catalog card template {} is unavailable; indexing every string of the card", card.get("templateRef"));
                leaves(cardContent, out, depth + 1);
            }
        }
    }

    private static void leaves(JsonNode node, TextBuilder out, int depth) {
        if (node == null || depth > MAX_DEPTH || out.full()) {
            return;
        }
        if (node.isTextual()) {
            String value = node.asText();
            if (!looksLikeUuid(value)) {
                out.add(value.indexOf('<') >= 0 ? HtmlText.toPlainText(value) : value);
            }
        } else if (node.isArray()) {
            node.forEach(child -> leaves(child, out, depth + 1));
        } else if (node.isObject()) {
            for (Iterator<Map.Entry<String, JsonNode>> it = node.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> field = it.next();
                if (!STRUCTURAL_KEYS.contains(field.getKey())) {
                    leaves(field.getValue(), out, depth + 1);
                }
            }
        }
    }

    /** A rich-text value: {@code {"format":"html","value":"…"}}, or a bare HTML string. */
    private static String richText(JsonNode value) {
        return value.isTextual() ? value.asText() : text(value.get("value"));
    }

    private static String label(EditorDefinition editor, String value) {
        if (value == null) {
            return null;
        }
        return editor.options().stream()
                .filter(option -> value.equals(option.value()))
                .map(SelectOption::label)
                .filter(label -> label != null && !label.isBlank())
                .findFirst()
                .orElse(value);
    }

    private static String text(JsonNode node) {
        return node != null && node.isTextual() ? node.asText() : null;
    }

    static Optional<UUID> uuid(JsonNode node) {
        if (node == null || !node.isTextual()) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(node.asText()));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static boolean looksLikeUuid(String value) {
        if (value.length() != 36) {
            return false;
        }
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
