package com.acme.staticforge.pagination;

import com.acme.staticforge.template.query.RecordView;
import java.util.UUID;

/**
 * One eligible item of a pagination source (M21.2.1), in the order pages slice it.
 *
 * @param uuid the target page (navigation source) or the record (dataset source)
 * @param uid the target page's or record's uid
 * @param displayName the target page's or record's display name
 * @param label the navigation label (the page reference's own label, else the target's display name); the record's
 *     display name
 * @param date the target page's {@code nav.date}, else its {@code publishedOn}; {@code null} for none and for records
 * @param position the target page's {@code nav.position} ({@code 0} when unset and for records)
 * @param referenceUuid the page reference that lists the target page; {@code null} for a record
 * @param record the record; {@code null} for a navigation item
 */
public record PaginationItem(
        UUID uuid,
        String uid,
        String displayName,
        String label,
        String date,
        int position,
        UUID referenceUuid,
        RecordView record) {

    /** Whether this item is a dataset record rather than a page. */
    public boolean isRecord() {
        return record != null;
    }
}
