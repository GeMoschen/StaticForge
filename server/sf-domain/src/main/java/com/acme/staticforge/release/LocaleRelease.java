package com.acme.staticforge.release;

import java.time.Instant;

/**
 * The release status of one (asset, locale) with the pointer it was computed from (M27.1.1). The pointer fields are
 * {@code null} when nothing is released in that locale ({@link ReleaseStatus#NEW}, {@link ReleaseStatus#UNPUBLISHED}).
 */
public record LocaleRelease(
        String localeKey,
        ReleaseStatus status,
        Long releasedVersionId,
        String releasedUid,
        Long releasedRevision,
        Instant releasedAt,
        Long releasedBy) {

    static LocaleRelease unreleased(String localeKey, ReleaseStatus status) {
        return new LocaleRelease(localeKey, status, null, null, null, null, null);
    }

    static LocaleRelease of(String localeKey, ReleaseStatus status, AssetRelease pointer) {
        return new LocaleRelease(
                localeKey,
                status,
                pointer.getReleasedVersionId(),
                pointer.getReleasedUid(),
                pointer.getValidFromRevision(),
                pointer.getReleasedAt(),
                pointer.getReleasedBy());
    }
}
