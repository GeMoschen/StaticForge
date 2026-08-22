package com.acme.staticforge.template.octl;

/**
 * A named argument on an OCTL instruction, for example {@code variant="w1600"} in
 * {@code $CMS_REF(media:logo_svg, variant="w400")$}.
 */
public record NamedArg(String name, String value) {}
