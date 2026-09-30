package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * What a release, unpublish or discard did (M27.1.3). {@code revision} is {@code null} when every item needed
 * nothing. {@code sharedFieldsKept} (discard only) lists the locales restored while shared values stayed as drafted.
 * {@code warnings} (release only) are the rule warnings the request accepted (M33.6).
 */
public record ReleaseResultView(
        Long revision,
        List<ReleaseTargetView> applied,
        List<ReleaseTargetView> skipped,
        List<ReleaseTargetView> sharedFieldsKept,
        List<ReleasePlanView.Incomplete> warnings) {}
