package com.acme.staticforge.asset;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import java.util.UUID;

/**
 * How a {@code RECORD} is named (M25): nobody names it. Its uid is its uuid in uid form, fixed for its whole
 * life; its display name is its dataset's title editor value, or the uuid while there is none. Neither can
 * be set or changed through any endpoint — a request to is {@code 422 SF-DOM-0105}. Records that predate
 * this keep the name and uid they have.
 */
public final class RecordNaming {

    private RecordNaming() {}

    /** A new record's uid, e.g. {@code 3f2a9c1e_8b7d_4c1a_9f00_12ab34cd56ef} — a well-formed, unique uid. */
    public static String uidOf(UUID uuid) {
        return uuid.toString().replace('-', '_');
    }

    /** The refusal of a rename or uid change of a record. */
    public static Problem derived() {
        return ProblemFactory.other(422, "SF-DOM-0105", "Validation Failed",
                "A record's uid and display name are derived (uid from its uuid, name from its title field) "
                        + "and can't be changed.");
    }
}
