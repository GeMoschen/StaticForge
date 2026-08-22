package com.acme.staticforge.generate.postprocess;

/** A single redirect rule ({@code from} source path to {@code to} destination path). */
public record Redirect(String from, String to) {

    public Redirect {
        from = from == null ? "" : from;
        to = to == null ? "" : to;
    }
}
