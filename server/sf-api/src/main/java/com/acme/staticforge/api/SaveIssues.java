package com.acme.staticforge.api;

import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.rules.RuleEngine;
import java.util.ArrayList;
import java.util.List;

/** The findings a save response carries (M33.4): the save's {@code read-only} notes, then the stored draft's own. */
final class SaveIssues {

    private SaveIssues() {}

    static List<ContentIssue> merge(List<ContentIssue> saveFindings, List<ContentIssue> stored) {
        List<ContentIssue> out = new ArrayList<>();
        saveFindings.stream().filter(f -> RuleEngine.CODE_READ_ONLY.equals(f.code())).forEach(out::add);
        out.addAll(stored);
        return out;
    }
}
