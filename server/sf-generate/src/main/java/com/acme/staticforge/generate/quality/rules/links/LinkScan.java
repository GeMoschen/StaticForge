package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.AssetLabel;
import com.acme.staticforge.generate.quality.CheckEnvironment;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.LinkRef;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.SiteIndex;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;

/**
 * What the link rules ({@code SF-CHK-01xx}, M30.2.1) share: the walk over every outgoing reference of the build and how
 * a message names a target.
 *
 * <p>The walk visits every checked HTML output of the {@link SiteIndex} — rendered by this run or carried, whose links
 * were resolved when they were rendered and are only looked up here — in path order, so findings come out in a stable
 * order. It leaves out the document's canonical link and its {@code hreflang} alternates: the SEO rules
 * ({@code SF-CHK-0210}, {@code SF-CHK-0211}) own those, and a broken one is reported once.
 */
final class LinkScan {

    /** Elements whose reference loads a file into the page rather than navigating to it. */
    private static final Set<String> MEDIA_ELEMENTS = Set.of("img", "source", "video", "audio", "script", "link");

    private LinkScan() {}

    /** One outgoing reference and the output it is written in. */
    record Link(IndexedOutput source, LinkRef ref) {

        OutputKey key() {
            return source.key();
        }

        /** The reference's resolved site path; {@code null} for an external or skipped one. */
        String target() {
            return ref.resolvedPath();
        }

        /** Whether the reference loads media ({@code img}, {@code source}, {@code video}, {@code audio}, {@code script}, {@code link}). */
        boolean media() {
            return MEDIA_ELEMENTS.contains(ref.element());
        }
    }

    /** Every internal reference of every checked output, in path and document order. */
    static List<Link> internalLinks(SiteIndex site) {
        List<Link> links = new ArrayList<>();
        for (Map.Entry<String, HtmlFacts> entry : new TreeMap<>(site.facts()).entrySet()) {
            Optional<IndexedOutput> source = site.output(entry.getKey());
            if (source.isEmpty()) {
                continue;
            }
            HtmlFacts facts = entry.getValue();
            Set<LinkRef> seo = new HashSet<>();
            if (facts.canonical() != null) {
                seo.add(facts.canonical());
            }
            facts.alternates().forEach(alternate -> seo.add(alternate.link()));
            for (LinkRef ref : facts.links()) {
                if (ref.internal() && !seo.contains(ref)) {
                    links.add(new Link(source.get(), ref));
                }
            }
        }
        return links;
    }

    /**
     * Keeps the first reference to each target per element: a {@code srcset} that names the same file twice, or a
     * repeated {@code href}, is one finding.
     */
    static boolean firstOf(Set<String> seen, Link link) {
        return seen.add(link.key().path() + '\u0000' + link.ref().selector() + '\u0000' + link.target());
    }

    /** {@code "gone.html"}, or {@code "../gone.html" (gone.html)} when the written URL isn't the resolved path. */
    static String written(Link link) {
        String raw = link.ref().raw().strip();
        String path = link.target();
        return raw.equals(path) ? quote(raw) : quote(raw) + " (" + path + ")";
    }

    /**
     * The reference events of {@code kind} of every output of an HTML channel, in path order. Other channels aren't
     * checked (epic decision 2), and only checked outputs keep their events in the sidecar for a later incremental run.
     */
    static List<Map.Entry<IndexedOutput, ReferenceEvent>> events(SiteIndex site, ReferenceEvent.Kind kind) {
        List<Map.Entry<IndexedOutput, ReferenceEvent>> events = new ArrayList<>();
        new TreeMap<>(site.referenceEvents()).forEach((path, list) -> site.output(path)
                .filter(output -> site.environment().isHtmlChannel(output.key().channel()))
                .ifPresent(output -> list.stream()
                        .filter(event -> event.kind() == kind)
                        .forEach(event -> events.add(Map.entry(output, event)))));
        return events;
    }

    /**
     * How a message names the target of a reference event: its kind, uid (or display name) and asset type, the language
     * it resolved in, and the editor path of the field that holds it — {@code page 'about' (PAGE, de) in field
     * content.cta}.
     */
    static String target(CheckEnvironment environment, ReferenceEvent event) {
        Optional<AssetLabel> label = environment.asset(event.target());
        String name = label.map(AssetLabel::name)
                .orElse(event.targetUid() != null && !event.targetUid().isBlank() ? event.targetUid()
                        : String.valueOf(event.target()));
        StringBuilder text = new StringBuilder(kindName(event.targetKind())).append(' ').append(quote(name));
        List<String> details = new ArrayList<>();
        label.map(AssetLabel::type).ifPresent(details::add);
        if (event.locale() != null && environment.localized()) {
            details.add(event.locale());
        }
        if (!details.isEmpty()) {
            text.append(" (").append(String.join(", ", details)).append(')');
        }
        return text.append(field(event)).toString();
    }

    /** How a message names the page, media file or site file at an existing output. */
    static String output(CheckEnvironment environment, IndexedOutput output) {
        Optional<AssetLabel> label = environment.asset(output.key().asset());
        return switch (output.kind()) {
            case PAGE -> "page " + label.map(l -> quote(l.name())).orElse(quote(output.path()));
            case MEDIA -> "media file " + label.map(l -> quote(l.name())).orElse(quote(output.path()));
            case SITE -> "site file " + quote(output.path());
        };
    }

    /** {@code " in field content.cta"} when the event knows the editor path of its reference; else {@code ""}. */
    static String field(ReferenceEvent event) {
        return event.editorPath() == null ? "" : " in field " + event.editorPath();
    }

    /** A reference kind as prose: {@code page}, {@code media}, {@code folder}, {@code section template}. */
    static String kindName(String targetKind) {
        return switch (targetKind) {
            case "section_template" -> "section template";
            default -> targetKind;
        };
    }

    static String quote(String value) {
        return "'" + value + "'";
    }
}
