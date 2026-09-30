package com.acme.staticforge.template.rules;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.List;

/**
 * What a rule, state or fill applies to (M33, epic decision 1): the whole definition — written as the kind keyword
 * {@code page}, {@code section}, {@code record} or {@code global} — or an editor path: {@code title}, {@code seo.title}
 * through a group, {@code gallery[]} for every row of a list, nested {@code gallery[].tags[]}. {@link #text()} is the path
 * as written ({@code gallery[].caption}), the key under which a state or fill is overridden.
 */
public record RulePath(String whole, List<Segment> segments, String text) {

    /** The keywords that name the whole definition. */
    public static final List<String> WHOLE_KEYWORDS = List.of("page", "section", "record", "global");

    /** One step of an editor path; {@code rows} when written {@code name[]}. */
    public record Segment(String name, boolean rows) {}

    public RulePath {
        segments = segments == null ? List.of() : List.copyOf(segments);
    }

    /** The whole definition, named by its kind keyword. */
    public static RulePath whole(String keyword) {
        return new RulePath(keyword, List.of(), keyword);
    }

    /** An editor path. */
    public static RulePath of(List<Segment> segments) {
        StringBuilder text = new StringBuilder();
        for (Segment s : segments) {
            if (!text.isEmpty()) {
                text.append('.');
            }
            text.append(s.name()).append(s.rows() ? "[]" : "");
        }
        return new RulePath(null, segments, text.toString());
    }

    /** Parses {@code a.b}, {@code list[]}, {@code list[].inner[]} or a whole-definition keyword; {@code null} if malformed. */
    public static RulePath parse(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        if (WHOLE_KEYWORDS.contains(text)) {
            return whole(text);
        }
        List<Segment> segments = new java.util.ArrayList<>();
        for (String part : text.split("\\.", -1)) {
            boolean rows = part.endsWith("[]");
            String name = rows ? part.substring(0, part.length() - 2) : part;
            if (!name.matches("[A-Za-z_][A-Za-z0-9_]*")) {
                return null;
            }
            segments.add(new Segment(name, rows));
        }
        return of(segments);
    }

    @JsonIgnore
    public boolean isWhole() {
        return whole != null;
    }

    /** Whether the path iterates list rows anywhere ({@code item}, {@code index} and {@code parent} are in scope). */
    @JsonIgnore
    public boolean hasRows() {
        return segments.stream().anyMatch(Segment::rows);
    }

    /** The first editor name, or {@code null} for the whole definition. */
    @JsonIgnore
    public String rootName() {
        return segments.isEmpty() ? null : segments.get(0).name();
    }

    @Override
    public String toString() {
        return text;
    }
}
