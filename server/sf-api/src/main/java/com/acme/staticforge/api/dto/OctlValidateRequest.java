package com.acme.staticforge.api.dto;

/**
 * OCTL validation request body (spec §20.2). With {@code templateUuid} the source is validated as that
 * template's channel (M20.4.1): references resolve against the project, a page template's chain is linked and
 * names are checked against its effective definition, using {@code contentCdl}/{@code bodiesCdl}/{@code rulesCdl} (the unsaved CDL sections, M34) when
 * any is given, otherwise the template's stored CDL. With {@code datasetUuid} (M25) it is validated as that dataset's
 * record template for {@code channelKey}: the record-template profile, names checked against the dataset schema
 * — the unsaved dataset CDL sections when given, otherwise the stored one. The two are
 * mutually exclusive.
 */
public record OctlValidateRequest(
        String source,
        String channelKey,
        String templateUuid,
        String contentCdl,
        String bodiesCdl,
        String rulesCdl,
        String datasetUuid) {

    /** The unsaved CDL sections, or {@code null} when none was sent (the stored CDL is used). */
    public com.acme.staticforge.template.cdl.CdlSources cdl() {
        return contentCdl == null && bodiesCdl == null && rulesCdl == null
                ? null
                : new com.acme.staticforge.template.cdl.CdlSources(contentCdl, bodiesCdl, rulesCdl);
    }
}
