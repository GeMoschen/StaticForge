package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.List;

/** A saved record plus the completeness findings that did not block the save (M19.1.2). */
public record RecordWriteResult(RecordDetail record, List<ContentIssue> issues) {}
