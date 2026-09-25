package com.acme.staticforge.release;

/** An (asset id, locale key) pair — the identity a release pointer and a release status belong to (M27.1.1). */
public record ReleasedKey(Long assetId, String localeKey) {}
