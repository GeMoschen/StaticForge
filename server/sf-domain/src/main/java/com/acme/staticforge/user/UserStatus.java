package com.acme.staticforge.user;

/** Account status of an application user (spec §8.2). */
public enum UserStatus {
    ACTIVE,
    DISABLED,
    LOCKED,
    /** Anonymized by an instance admin (M26): kept for history, never signs in again. */
    DELETED
}
