package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.OctlExpressions;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryParser;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The record grid's request parsing and paging (M19.2.1), shared by the dataset listing
 * ({@link RecordService#list}) and the record set listing ({@link RecordSetService#listRecords}, M25.1.2),
 * so both read {@code where}/{@code sort} with one parser and page rows the same way.
 */
final class RecordGrid {

    private static final int MAX_PAGE_SIZE = 500;

    private RecordGrid() {}

    /** {@code 400} unless {@code page >= 0} and {@code 1 <= size <= 500}. */
    static void checkPaging(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new SfException(ProblemFactory.badRequest("page must be >= 0 and size between 1 and 500."));
        }
    }

    /**
     * The listing's {@code where}/{@code sort} as a query over bare field names, checked against the
     * dataset schema; invalid input is a {@code 400} ({@code column} for a malformed {@code where}).
     */
    static DatasetQuery listingQuery(ContentDefinition definition, RecordListQuery query) {
        Expr where = null;
        if (query.where() != null && !query.where().isBlank()) {
            OctlExpressions.Parsed parsed = OctlExpressions.parse(query.where());
            if (!parsed.ok()) {
                throw badQuery("Invalid where expression at column " + parsed.column() + ": " + parsed.error(),
                        parsed.column());
            }
            List<Diagnostic> rootErrors =
                    DatasetQueryParser.parse(Map.of("where", query.where()), null, 0, 0).diagnostics();
            if (!rootErrors.isEmpty()) {
                throw badQuery(rootErrors.get(0).message(), 0);
            }
            where = parsed.expr();
        }
        DatasetQuery datasetQuery = new DatasetQuery(null, where, query.sort(), null, null, null);
        List<Diagnostic> fieldErrors = DatasetQueryParser.validateFields(datasetQuery, definition, 0, 0);
        if (!fieldErrors.isEmpty()) {
            throw badQuery(fieldErrors.get(0).message(), 0);
        }
        return datasetQuery;
    }

    /**
     * One page of {@code selected} (already filtered and ordered) as grid rows: identity, place, audit and
     * the values of the schema's scalar editors.
     *
     * @param stored the record as stored, by uuid, when {@code selected} holds language-resolved views
     *     ({@code null}: {@code selected} is as stored); rows always show stored values, like the dataset grid
     * @param changedBy the last editor of each record, by uuid
     */
    static RecordPage page(
            List<RecordView> selected,
            ContentDefinition definition,
            Map<UUID, RecordView> stored,
            Map<UUID, Long> changedBy,
            int page,
            int size) {
        int from = (int) Math.min((long) page * size, selected.size());
        int to = Math.min(from + size, selected.size());

        List<String> scalarFields = scalarFields(definition);
        List<RecordPage.Row> rows = new ArrayList<>(to - from);
        for (RecordView selectedRecord : selected.subList(from, to)) {
            RecordView record = stored == null ? selectedRecord : stored.getOrDefault(selectedRecord.uuid(), selectedRecord);
            ObjectNode values = JsonNodeFactory.instance.objectNode();
            for (String field : scalarFields) {
                JsonNode value = record.content().get(field);
                if (value != null && value.isValueNode()) {
                    values.set(field, value);
                }
            }
            rows.add(new RecordPage.Row(
                    record.uuid(), record.uid(), record.displayName(), record.folderPath(), record.changedAt(),
                    changedBy.get(record.uuid()), values));
        }
        return new RecordPage(rows, selected.size(), page, size);
    }

    /** The names of the schema's scalar editors, groups being transparent. */
    private static List<String> scalarFields(ContentDefinition definition) {
        List<String> fields = new ArrayList<>();
        collectScalar(definition.editors(), fields);
        return fields;
    }

    private static void collectScalar(List<EditorDefinition> editors, List<String> fields) {
        for (EditorDefinition editor : editors) {
            if (editor.isGroup()) {
                collectScalar(editor.items(), fields);
            } else if (DatasetQueryParser.SCALAR_TYPES.contains(editor.type())) {
                fields.add(editor.name());
            }
        }
    }

    private static SfException badQuery(String detail, int column) {
        Problem.Builder problem = Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0400")
                .title("Bad Request")
                .status(400)
                .detail(detail)
                .property("code", "SF-API-0400");
        if (column > 0) {
            problem.property("column", column);
        }
        return new SfException(problem.build());
    }
}
