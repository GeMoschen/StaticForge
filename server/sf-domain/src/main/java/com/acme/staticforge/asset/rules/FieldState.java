package com.acme.staticforge.asset.rules;

/**
 * The computed state of a field (M33.3): {@code required} from a {@code requiredWhen} that holds, {@code readOnly} from
 * a {@code readOnlyWhen} that holds or a {@code mode always} fill — {@code computed} tells the latter apart: the fill
 * recomputes such a field on every save, so the save gate doesn't restore it (M33.4). {@code locale} is set for a
 * language-dependent field.
 */
public record FieldState(String path, String locale, boolean required, boolean readOnly, boolean computed) {

    public FieldState(String path, String locale, boolean required, boolean readOnly) {
        this(path, locale, required, readOnly, false);
    }
}
