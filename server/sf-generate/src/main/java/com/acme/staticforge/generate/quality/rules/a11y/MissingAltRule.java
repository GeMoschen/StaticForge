package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.AssetLabel;
import com.acme.staticforge.generate.quality.CheckEnvironment;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.LinkResolver;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.target.BuildManifest;
import java.util.List;
import java.util.Optional;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0301} "Image without alt attribute" (M30.2.3): every {@code img} and {@code input type=image} without an
 * {@code alt} attribute. {@code alt=""} marks a decorative image and passes. When the {@code src} resolves to a media
 * output of the build, the message names the media asset, so the editor knows which file lacks alt text.
 */
@Component
public class MissingAltRule implements PageRule {

    public static final String CODE = "SF-CHK-0301";

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.ACCESSIBILITY;
    }

    @Override
    public String name() {
        return "Image without alt attribute";
    }

    @Override
    public String description() {
        return "An image (img or input type=image) has no alt attribute, so screen readers announce its file name. "
                + "Fix in content when the message names a media asset: give the media alt text (the template must "
                + "write it into alt). Fix in the template when the image is hard-coded there, or when the template "
                + "doesn't write the media's alt text; use alt=\"\" for a purely decorative image.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return output.document().select("img:not([alt]), input[type=image]:not([alt])").stream()
                .map(image -> context.finding(image, message(image, output, context.environment())))
                .toList();
    }

    private static String message(Element image, ParsedOutput output, CheckEnvironment environment) {
        String what = image.normalName().equals("img") ? "Image" : "Image button";
        String src = image.attr("src").strip();
        if (src.isEmpty()) {
            return what + " without alt attribute.";
        }
        return media(src, output, environment)
                .map(label -> what + " without alt attribute: media \"" + label.name() + "\" (" + src + ").")
                .orElse(what + " without alt attribute: " + src + ".");
    }

    /** The media asset {@code src} shows, when it resolves to a media output of the build. */
    private static Optional<AssetLabel> media(String src, ParsedOutput output, CheckEnvironment environment) {
        LinkResolver.Target target = environment.resolverFor(output.key().channel()).resolve(output.path(), src);
        return environment.output(target == null ? null : target.path())
                .filter(indexed -> indexed.kind() == BuildManifest.Kind.MEDIA)
                .map(IndexedOutput::key)
                .flatMap(key -> environment.asset(key.asset()));
    }
}
