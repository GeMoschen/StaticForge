package com.acme.staticforge.generate.quality;

/**
 * How a project treats a quality rule's findings (M30, epic decisions 4 and 5), in increasing order: {@link #OFF}
 * doesn't run the rule, {@link #WARNING} reports only, {@link #ERROR} also holds the offending page back. A finding
 * carries {@code WARNING} or {@code ERROR}, never {@code OFF}.
 */
public enum QualitySeverity {
    OFF,
    WARNING,
    ERROR;

    /** The lower of the two severities. */
    public QualitySeverity cappedAt(QualitySeverity max) {
        return compareTo(max) <= 0 ? this : max;
    }

    /** The severity named {@code value}, case-insensitively; {@code null} when there is none. */
    public static QualitySeverity parse(String value) {
        if (value == null) {
            return null;
        }
        for (QualitySeverity severity : values()) {
            if (severity.name().equalsIgnoreCase(value.trim())) {
                return severity;
            }
        }
        return null;
    }
}
