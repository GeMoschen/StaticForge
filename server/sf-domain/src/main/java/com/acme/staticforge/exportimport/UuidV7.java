package com.acme.staticforge.exportimport;

import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * UUIDv7 (time-ordered) generation per RFC 9562 (spec §6.1). Import creates fresh
 * time-ordered UUIDs for index locality; the timestamp occupies the high 48 bits with
 * the version {@code 0111} and variant {@code 10} bits set in the correct positions.
 */
public final class UuidV7 {

    private UuidV7() {}

    /** Returns a new UUIDv7 (version 7, variant 2/IETF). */
    public static UUID generate() {
        long millis = System.currentTimeMillis();
        long randA = ThreadLocalRandom.current().nextLong();
        long randB = ThreadLocalRandom.current().nextLong();

        long msb = (millis << 16)          // 48-bit unix-ms timestamp in bits 16..63
                | 0x7000L                  // version 7 in bits 12..15
                | (randA & 0x0FFFL);       // 12 random bits in bits 0..11
        long lsb = (randB & 0x3FFF_FFFF_FFFF_FFFFL)   // 62 random bits
                | 0x8000_0000_0000_0000L;              // variant bits "10"
        return new UUID(msb, lsb);
    }
}
