package com.acme.staticforge.generate.quality.rules.a11y;

import java.util.Locale;
import java.util.Set;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;

/**
 * The part of the accessible-name computation (W3C accname) that static markup can answer, for the accessibility
 * rules (M30.2.3): does an element get a non-empty name from {@code aria-labelledby}, {@code aria-label}, its content
 * (text, {@code img[alt]}, a nested {@code aria-label}) or {@code title}? No computed styles: an element is hidden only
 * by the {@code hidden} attribute or {@code aria-hidden="true"}.
 */
final class AccessibleNames {

    /** Elements whose content never contributes to a name. */
    private static final Set<String> SILENT = Set.of("script", "style", "template", "noscript", "select", "textarea");

    private AccessibleNames() {}

    /** Whether {@code element} has a non-empty accessible name. */
    static boolean hasName(Element element) {
        return !isBlank(labelledBy(element))
                || !isBlank(element.attr("aria-label"))
                || !isBlank(content(element))
                || !isBlank(element.attr("title"));
    }

    /**
     * The text of the elements {@code aria-labelledby} names, joined with spaces; ids that name no element of the
     * document contribute nothing, so a reference to a missing id gives no name.
     */
    static String labelledBy(Element element) {
        String ids = element.attr("aria-labelledby").strip();
        if (ids.isEmpty()) {
            return "";
        }
        Element root = element.root();
        StringBuilder text = new StringBuilder();
        for (String id : ids.split("\\s+")) {
            Element target = root.getElementById(id);
            if (target != null && target != element) {
                String label = !isBlank(target.attr("aria-label")) ? target.attr("aria-label") : content(target);
                text.append(label).append(' ');
            }
        }
        return text.toString().strip();
    }

    /**
     * The name {@code element}'s content gives it: its text, the {@code alt} of the images in it (an {@code alt=""}
     * image gives nothing), and the {@code aria-label} of a nested element in place of that element's own content.
     * Hidden descendants, scripts, styles and embedded {@code select}/{@code textarea} controls give nothing.
     */
    static String content(Element element) {
        StringBuilder text = new StringBuilder();
        appendContent(element, text);
        return text.toString().strip();
    }

    private static void appendContent(Element element, StringBuilder text) {
        for (Node child : element.childNodes()) {
            if (child instanceof TextNode textNode) {
                text.append(textNode.text());
            } else if (child instanceof Element nested && !hiddenItself(nested) && !SILENT.contains(nested.normalName())) {
                if (!isBlank(nested.attr("aria-label"))) {
                    text.append(' ').append(nested.attr("aria-label")).append(' ');
                } else if (isImage(nested)) {
                    text.append(' ').append(nested.attr("alt")).append(' ');
                } else {
                    appendContent(nested, text);
                }
            }
        }
    }

    /** An {@code img}, {@code area} or {@code input type=image}: named by its {@code alt}. */
    private static boolean isImage(Element element) {
        return switch (element.normalName()) {
            case "img", "area" -> true;
            case "input" -> type(element).equals("image");
            default -> false;
        };
    }

    /** The {@code type} of an {@code input}, lower case and trimmed; {@code "text"} when absent (as in HTML). */
    static String type(Element input) {
        String type = input.attr("type").strip().toLowerCase(Locale.ROOT);
        return type.isEmpty() ? "text" : type;
    }

    /**
     * Whether {@code element} is hidden from assistive technology: it or an ancestor carries {@code hidden} or
     * {@code aria-hidden="true"}. A hidden element needs no name.
     */
    static boolean hidden(Element element) {
        for (Element current = element; current != null; current = current.parent()) {
            if (hiddenItself(current)) {
                return true;
            }
        }
        return false;
    }

    private static boolean hiddenItself(Element element) {
        return element.hasAttr("hidden") || element.attr("aria-hidden").strip().equalsIgnoreCase("true");
    }

    /** Whether {@code value} is empty or only whitespace, including the no-break space {@code &nbsp;} renders as. */
    static boolean isBlank(String value) {
        return value == null || value.chars().allMatch(c -> Character.isWhitespace(c) || Character.isSpaceChar(c));
    }
}
