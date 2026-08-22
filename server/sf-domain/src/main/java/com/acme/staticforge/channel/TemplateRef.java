package com.acme.staticforge.channel;

/** A template that still has a channel template for a given channel key (spec §15.3). */
public record TemplateRef(String uuid, String uid, String displayName) {}
