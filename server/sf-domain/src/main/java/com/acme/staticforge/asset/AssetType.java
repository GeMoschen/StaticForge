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
    GLOBAL_SET,
    /**
     * A dataset schema (M19): a CDL content definition (editors only, no bodies) whose values live in
     * {@link #RECORD} assets. Developer-owned; lives in the Templates store's fixed {@code datasets} folder.
     */
    DATASET,
    /**
     * One entry of a dataset (M19): {@code payload = {datasetRef, content}}, in the foldered Content
     * store. The dataset link is mirrored into {@code asset_version.template_asset_id}. Since M25 its
     * parent is always a {@link #RECORD_SET} of the same dataset, never a folder.
     */
    RECORD,
    /**
     * A record set (M25): {@code payload = {datasetRef, query{where, sort, limit, offset}}}, in a
     * Content-store folder. It fixes the dataset of its records (its direct children, the only assets
     * it may hold) and stores the query selecting and ordering them. The dataset link is mirrored into
     * {@code asset_version.template_asset_id}, like a record's.
     */
    RECORD_SET
}
