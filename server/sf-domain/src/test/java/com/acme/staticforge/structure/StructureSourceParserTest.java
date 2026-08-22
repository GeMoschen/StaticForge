package com.acme.staticforge.structure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.common.SfException;
import org.junit.jupiter.api.Test;

class StructureSourceParserTest {

    private final StructureSourceParser parser = new StructureSourceParser();

    @Test
    void parsesFullNavigationSource() {
        StructureSource source = parser.parse("""
                navigation {
                  source {
                    root      page:home
                    depth     5
                    include   pages where nav.visible == true
                    exclude   pages where nav.noIndex == true
                    order by  nav.position asc, displayName asc
                    expand    activePathOnly
                  }
                }
                """);

        assertThat(source.kind()).isEqualTo(StructureKind.NAVIGATION);
        assertThat(source.root()).isEqualTo(new StructureRoot(RootKind.PAGE, "home"));
        assertThat(source.depth()).isEqualTo(5);
        assertThat(source.include()).containsExactly("nav.visible == true");
        assertThat(source.exclude()).containsExactly("nav.noIndex == true");
        assertThat(source.orderBy()).containsExactly(
                new OrderClause("nav.position", true),
                new OrderClause("displayName", true));
        assertThat(source.expand()).isEqualTo(ExpandMode.ACTIVE_PATH_ONLY);
    }

    @Test
    void parsesFolderRootAndDescendingOrder() {
        StructureSource source = parser.parse("""
                list {
                  source {
                    root      folder:/products/
                    order by  nav.position desc
                    expand    all
                  }
                }
                """);

        assertThat(source.kind()).isEqualTo(StructureKind.LIST);
        assertThat(source.root()).isEqualTo(new StructureRoot(RootKind.FOLDER, "/products/"));
        assertThat(source.orderBy()).containsExactly(new OrderClause("nav.position", false));
        assertThat(source.expand()).isEqualTo(ExpandMode.ALL);
    }

    @Test
    void omitsBlockAndAppliesDefaults() {
        StructureSource source = parser.parse("breadcrumb { source { root page:home } }");

        assertThat(source.kind()).isEqualTo(StructureKind.BREADCRUMB);
        assertThat(source.depth()).isEqualTo(StructureSource.DEFAULT_DEPTH);
        assertThat(source.include()).isEmpty();
        assertThat(source.exclude()).isEmpty();
        assertThat(source.orderBy()).isEqualTo(StructureSource.DEFAULT_ORDER);
        assertThat(source.expand()).isEqualTo(ExpandMode.ACTIVE_PATH_ONLY);
    }

    @Test
    void toleratesUnknownKeywordsAndNodeBlock() {
        StructureSource source = parser.parse("""
                navigation {
                  source {
                    root      page:home
                    magic     42
                  }
                  node {
                    label coalesce(nav.label, displayName)
                  }
                }
                """);

        assertThat(source.kind()).isEqualTo(StructureKind.NAVIGATION);
        assertThat(source.root()).isEqualTo(new StructureRoot(RootKind.PAGE, "home"));
    }

    @Test
    void roundTripsThroughText() {
        StructureSource original = parser.parse("""
                navigation {
                  source {
                    root      folder:/products/
                    depth     4
                    include   pages where nav.visible == true
                    order by  nav.position asc, displayName asc
                    expand    all
                  }
                }
                """);
        StructureSource reparsed = parser.parse(parser.toText(original));
        assertThat(reparsed).isEqualTo(original);
    }

    @Test
    void rejectsMissingKind() {
        assertThatThrownBy(() -> parser.parse("source { root page:home }"))
                .isInstanceOf(SfException.class)
                .hasMessageContaining("Validation Failed");
    }

    @Test
    void rejectsEmptySource() {
        assertThatThrownBy(() -> parser.parse("   "))
                .isInstanceOf(SfException.class);
    }

    @Test
    void rejectsMalformedRoot() {
        assertThatThrownBy(() -> parser.parse("navigation { source { root bogus } }"))
                .isInstanceOf(SfException.class);
    }
}
