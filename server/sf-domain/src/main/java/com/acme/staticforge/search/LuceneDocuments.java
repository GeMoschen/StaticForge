package com.acme.staticforge.search;

import java.util.Locale;
import org.apache.lucene.document.Document;
import org.apache.lucene.document.Field;
import org.apache.lucene.document.SortedSetDocValuesField;
import org.apache.lucene.document.StoredField;
import org.apache.lucene.document.StringField;
import org.apache.lucene.document.TextField;
import org.apache.lucene.util.BytesRef;

/** Maps a {@link SearchDocument} to its Lucene document and back (M23.1.1). */
final class LuceneDocuments {

    private LuceneDocuments() {}

    static Document toLucene(SearchDocument source, int maxTextChars) {
        Document doc = new Document();
        doc.add(new StringField(SearchFields.UUID, source.uuid().toString(), Field.Store.YES));
        doc.add(new StringField(SearchFields.TYPE, source.assetType().name(), Field.Store.YES));
        doc.add(new SortedSetDocValuesField(SearchFields.TYPE, new BytesRef(source.assetType().name())));
        doc.add(new StringField(SearchFields.UID, source.uid(), Field.Store.YES));
        doc.add(new StringField(SearchFields.UID_LOWER, source.uid().toLowerCase(Locale.ROOT), Field.Store.NO));
        doc.add(new StringField(SearchFields.FOLDER_PATH, source.folderPath(), Field.Store.YES));
        for (String status : source.releaseStatuses()) {
            doc.add(new StringField(SearchFields.RELEASE_STATUS, status, Field.Store.NO));
        }
        doc.add(new StoredField(SearchFields.DISPLAY_NAME, source.displayName()));
        if (source.templateUuid() != null) {
            doc.add(new StoredField(SearchFields.TEMPLATE_UUID, source.templateUuid().toString()));
        }
        doc.add(new StoredField(SearchFields.REVISION, source.revision()));
        doc.add(new TextField(SearchFields.TITLE, source.title(), Field.Store.YES));

        // The neutral field carries everything, so an unfiltered search still finds every language;
        // each language field carries the neutral text plus its own, so its analyzer stems the right
        // language (M24.3.3).
        String all = TextCap.cap(source.allText(), maxTextChars);
        String code = TextCap.cap(source.source(), Math.max(0, maxTextChars - all.length()));
        doc.add(new TextField(SearchFields.TEXT, all, Field.Store.NO));
        for (String field : SearchFields.PROSE) {
            if (field.equals(SearchFields.TEXT)) {
                continue;
            }
            String forField = source.textByLocale().isEmpty()
                    ? all
                    : TextCap.cap(textForField(source, field), maxTextChars);
            doc.add(new TextField(field, forField, Field.Store.NO));
        }
        doc.add(new TextField(SearchFields.SOURCE, code, Field.Store.NO));
        doc.add(new StoredField(SearchFields.SNIPPET_SOURCE, snippetSource(all, code)));
        return doc;
    }

    /** The prose a language field indexes: the neutral text plus every language mapping to that field. */
    private static String textForField(SearchDocument source, String field) {
        StringBuilder out = new StringBuilder(source.text());
        source.textByLocale().forEach((locale, value) -> {
            if (SearchFields.proseFor(locale).equals(field) && !value.isBlank()) {
                if (!out.isEmpty()) {
                    out.append('\n');
                }
                out.append(value);
            }
        });
        return out.toString();
    }

    /**
     * The stored text snippets and highlights are computed on: prose, a newline, code. Prose and code are analyzed
     * separately, so the offsets of one never cross into the other.
     */
    static String snippetSource(String text, String code) {
        if (code.isEmpty()) {
            return text;
        }
        return text.isEmpty() ? code : text + "\n" + code;
    }
}
