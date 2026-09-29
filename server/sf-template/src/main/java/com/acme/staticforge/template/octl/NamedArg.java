package com.acme.staticforge.template.octl;

/**
 * A named argument on an OCTL instruction, for example {@code variant="w1600"} in
 * {@code $CMS_REF(media:logo_svg, variant="w400")$}.
 *
 * <p>{@code expression} is set only on a {@code $CMS_REF} argument written without quotes: the dotted path it names
 * ({@code locale=l}, {@code locale=l.code}), evaluated when the reference renders. A single word that resolves to
 * nothing keeps its literal meaning, {@code value} ({@code variant=w400}, {@code locale=de-CH}). A quoted argument is
 * always literal and has no expression.
 */
public record NamedArg(String name, String value, Accessor expression) {

    /** A literal argument. */
    public NamedArg(String name, String value) {
        this(name, value, null);
    }
}
