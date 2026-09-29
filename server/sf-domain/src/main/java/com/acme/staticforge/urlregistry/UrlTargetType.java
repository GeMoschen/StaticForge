package com.acme.staticforge.urlregistry;

/**
 * What a URL registry row names (M32.1): a page output (one per page number of a paginated page), a media file (one
 * per variant and language) or a folder without an index page. Page references and folders with an index page never
 * have rows: their URL is their page's.
 */
public enum UrlTargetType {
    PAGE,
    MEDIA,
    FOLDER
}
