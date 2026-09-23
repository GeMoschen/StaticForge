package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.List;
import org.junit.jupiter.api.Test;

/** {@code M25.2.2}: a {@code reference} editor that picks record sets, optionally of one dataset. */
class RecordSetReferenceCdlTest {

    private final CdlCompiler compiler = new CdlCompiler();

    @Test
    void aReferenceEditorCanPickTheRecordSetsOfOneDataset() {
        var result = compiler.compile("content { editor reference x { label \"X\" assetTypes [RECORD_SET] dataset \"team\" } }");

        assertThat(result.diagnostics()).isEmpty();
        EditorDefinition editor = result.definition().findEditor("x").orElseThrow();
        assertThat(editor.assetTypes()).containsExactly("RECORD_SET");
        assertThat(editor.dataset()).isEqualTo("team");
    }

    @Test
    void recordsAndSetsTogetherOrRecordsAloneStillCompile() {
        assertThat(codes("content { editor reference x { label \"X\" assetTypes [RECORD, RECORD_SET] dataset \"team\" } }"))
                .isEmpty();
        assertThat(codes("content { editor reference x { label \"X\" assetTypes [RECORD] dataset \"team\" } }")).isEmpty();
        assertThat(codes("content { editor reference x { label \"X\" dataset \"team\" } }")).isEmpty();
    }

    @Test
    void aDatasetRestrictionNeedsRecordsOrSetsAmongTheAssetTypes() {
        var result = compiler.compile("content { editor reference x { label \"X\" assetTypes [PAGE] dataset \"team\" } }");

        assertThat(result.diagnostics()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
        assertThat(result.diagnostics().get(0).message()).contains("RECORD_SET");
    }

    private List<String> codes(String cdl) {
        return compiler.compile(cdl).diagnostics().stream().map(Diagnostic::code).toList();
    }
}
