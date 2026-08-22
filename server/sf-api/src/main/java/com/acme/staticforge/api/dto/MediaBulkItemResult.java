package com.acme.staticforge.api.dto;

/** One entry of a bulk upload result: either a success (media set) or a failure (error set). */
public record MediaBulkItemResult(
        String fileName, MediaView media, Integer errorStatus, String errorCode, String errorDetail) {}
