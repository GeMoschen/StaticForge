package com.acme.staticforge.asset.media;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** The problem details of localized media (M27.3.1, Appendix B {@code SF-MEDIA-0505}–{@code 0509}). */
final class MediaProblems {

    private MediaProblems() {}

    /** {@code 409 SF-MEDIA-0505}: un-localizing would discard the listed locale files; repeat with {@code confirmDiscard}. */
    static SfException localeFilesWouldBeDiscarded(List<Map<String, Object>> files) {
        return problem(409, "Conflict", "SF-MEDIA-0505",
                "Un-localizing keeps only the default language's file; the other language files would be discarded."
                        + " Confirm to discard them.",
                files);
    }

    /** {@code 422 SF-MEDIA-0506}: a per-locale file operation on media that isn't localized. */
    static SfException notLocalized() {
        return problem(422, "Unprocessable Entity", "SF-MEDIA-0506",
                "This media file is not localized: it has one file for every language.", null);
    }

    /** {@code 422 SF-MEDIA-0507}: a locale the project doesn't declare. */
    static SfException unknownLocale(String locale) {
        return problem(422, "Unprocessable Entity", "SF-MEDIA-0507",
                "'" + locale + "' is not one of the project's languages.", null);
    }

    /** {@code 422 SF-MEDIA-0508}: localizing media in a project without locales. */
    static SfException projectHasNoLocales() {
        return problem(422, "Unprocessable Entity", "SF-MEDIA-0508",
                "The project has no languages; media can only be localized in a project with languages.", null);
    }

    /** {@code 422 SF-MEDIA-0509}: removing the default language's file, which every other language falls back to. */
    static SfException defaultFileRequired(String locale) {
        return problem(422, "Unprocessable Entity", "SF-MEDIA-0509",
                "The file of '" + locale + "' is the one every other language falls back to; replace it instead.", null);
    }

    private static SfException problem(int status, String title, String code, String detail, Object files) {
        Problem.Builder builder = Problem.builder()
                .type("https://cms.example.com/problems/" + code.toLowerCase(Locale.ROOT))
                .title(title)
                .status(status)
                .detail(detail)
                .property("code", code);
        if (files != null) {
            builder.property("files", files);
        }
        return new SfException(builder.build());
    }
}
