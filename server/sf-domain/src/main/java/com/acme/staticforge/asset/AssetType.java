package com.acme.staticforge.asset;

/** Asset type discriminator (spec §3, §5.1). */
public enum AssetType {
    PAGE,
    MEDIA,
    SECTION_TEMPLATE,
    PAGE_TEMPLATE,
    FOLDER,
    PAGE_REFERENCE,
    /** A global property set (M17): one CDL-declared schema plus its values, in the Globals store. */
    GLOBAL_SET
}
