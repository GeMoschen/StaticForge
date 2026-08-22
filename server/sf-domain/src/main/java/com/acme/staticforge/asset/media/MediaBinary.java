package com.acme.staticforge.asset.media;

/** The bytes of a media blob (or a named variant), with enough metadata to serve it. */
public record MediaBinary(String mimeType, byte[] bytes, String fileName) {}
