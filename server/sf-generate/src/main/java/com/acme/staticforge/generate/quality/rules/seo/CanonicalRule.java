package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.LinkRef;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.RuleParam;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.generate.target.BuildManifest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0211} "Canonical missing, not absolute when {@code baseUrl} is set, or pointing at a non-existent
 * output" (M30.2.2). A {@code <link rel="canonical">}, when present, must resolve to a page output of this build; a
 * paginated page's output may point at page 1 or at itself, not at another page number of the same page. When the
 * target has a {@code baseUrl}, the URL must be absolute ({@code https://…}): search engines treat a relative canonical
 * as a hint at best. A canonical to another host is not checked (no network, epic decision 1). With {@code required}
 * a page without a canonical is a finding too.
 */
@Component
public class CanonicalRule implements SiteRule {

    static final String REQUIRED = "required";

    private static final Pattern ABSOLUTE = Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://");

    @Override
    public String code() {
        return "SF-CHK-0211";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "Canonical link missing or broken";
    }

    @Override
    public String description() {
        return "The page's <link rel=\"canonical\"> points at no page of this build, is relative although the target "
                + "has a base URL, or (on a paginated page) points at a page number other than 1 or its own. With "
                + "'required', a page without a canonical link is reported as well. Build it in the page template, "
                + "e.g. from CMS_PAGINATION.canonicalHref on a paginated page.";
    }

    @Override
    public List<RuleParam> params() {
        return List.of(RuleParam.bool(REQUIRED, false, "Report pages without a canonical link."));
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        boolean required = context.boolParam(REQUIRED);
        String baseUrl = context.environment().baseUrl();
        List<Finding> findings = new ArrayList<>();
        for (Map.Entry<String, HtmlFacts> entry : new TreeMap<>(site.facts()).entrySet()) {
            IndexedOutput output = site.output(entry.getKey()).orElse(null);
            if (output == null || output.kind() != BuildManifest.Kind.PAGE) {
                continue;
            }
            LinkRef canonical = entry.getValue().canonical();
            if (canonical == null) {
                if (required) {
                    findings.add(context.finding(output.key(), null, "The page has no <link rel=\"canonical\">."));
                }
                continue;
            }
            String problem = problem(site, output.key(), canonical, baseUrl);
            if (problem != null) {
                findings.add(context.finding(output.key(), canonical.selector(), problem));
            }
        }
        return findings;
    }

    private static String problem(SiteIndex site, OutputKey self, LinkRef canonical, String baseUrl) {
        String raw = canonical.raw() == null ? "" : canonical.raw().strip();
        if (raw.isEmpty()) {
            return "The canonical link is empty.";
        }
        boolean absolute = ABSOLUTE.matcher(raw).lookingAt();
        if (!canonical.internal()) {
            // Another host is not ours to check; a relative URL that leaves the site is simply wrong.
            return absolute || raw.startsWith("//") ? null
                    : "The canonical link \"" + raw + "\" leads outside the site.";
        }
        IndexedOutput target = site.output(canonical.resolvedPath()).orElse(null);
        if (target == null) {
            return "The canonical link \"" + raw + "\" points at " + canonical.resolvedPath()
                    + ", which is not an output of this build.";
        }
        if (target.kind() != BuildManifest.Kind.PAGE) {
            return "The canonical link \"" + raw + "\" points at " + canonical.resolvedPath() + ", which is not a page.";
        }
        if (!baseUrl.isBlank() && !absolute) {
            return "The canonical link \"" + raw + "\" is relative; with the target's base URL it must be absolute ("
                    + join(baseUrl, canonical.resolvedPath()) + ").";
        }
        OutputKey to = target.key();
        boolean samePage = Objects.equals(to.asset(), self.asset()) && Objects.equals(to.channel(), self.channel())
                && Objects.equals(to.locale(), self.locale());
        if (self.pageNumber() != null && samePage && to.number() != 1 && !to.path().equals(self.path())) {
            return "The canonical link of page " + self.number() + " points at page " + to.number()
                    + " of the same page; it should point at page 1 or at itself.";
        }
        return null;
    }

    private static String join(String baseUrl, String path) {
        return (baseUrl.endsWith("/") ? baseUrl : baseUrl + "/") + path;
    }
}
