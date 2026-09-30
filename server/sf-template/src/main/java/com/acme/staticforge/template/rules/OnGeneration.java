package com.acme.staticforge.template.rules;

/**
 * What a failing {@code error} rule does to a build (M33, user decision 11): {@code HOLD_BACK} holds the page back in
 * that language and the run ends {@code PARTIAL} (the behavior of built-in completeness errors); {@code FAIL} lets the
 * VALIDATE stage report every page, then fails the run without publishing anything.
 */
public enum OnGeneration {
    HOLD_BACK("holdBack"),
    FAIL("fail");

    private final String keyword;

    OnGeneration(String keyword) {
        this.keyword = keyword;
    }

    public String keyword() {
        return keyword;
    }

    /** The value named by a CDL keyword, or {@code null}. */
    public static OnGeneration fromKeyword(String keyword) {
        for (OnGeneration value : values()) {
            if (value.keyword.equals(keyword)) {
                return value;
            }
        }
        return null;
    }
}
