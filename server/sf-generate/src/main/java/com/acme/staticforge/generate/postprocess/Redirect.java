package com.acme.staticforge.generate.postprocess;

/**
 * One redirect a build emits (M30.4.2): the output path {@code from} of a channel and locale leads to {@code to} — the
 * target's output path in the same channel and locale (optionally with query and fragment), or an absolute
 * {@code http(s)} URL.
 *
 * @param locale the locale key; {@code ""} in a project without locales
 */
public record Redirect(String from, String to, String channel, String locale) {

    public Redirect {
        from = from == null ? "" : from;
        to = to == null ? "" : to;
        channel = channel == null ? "" : channel;
        locale = locale == null ? "" : locale;
    }
}
