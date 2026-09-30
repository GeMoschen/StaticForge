/**
 * The words the code editors know (M33): CDL keywords by role, the expression language v2 functions and context
 * names, OCTL instructions. Highlighting and completion both read these lists; they mirror the server's CDL lexer
 * (`CdlLexer.KEYWORDS`), `ExpressionFunctions` and the OCTL parser.
 */

/** Words that open a section or an entry. */
export const CDL_STRUCTURE = [
  'content',
  'bodies',
  'rules',
  'editor',
  'group',
  'item',
  'body',
  'rule',
  'state',
  'fill',
  'validate',
] as const;

/** Editor types (after `editor`). */
export const CDL_EDITOR_TYPES = [
  'text',
  'textarea',
  'richtext',
  'markdown',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'color',
  'link',
  'media',
  'reference',
  'list',
  'json',
  'catalog',
  'pagination',
] as const;

/** Attributes of editors, bodies and rule entries. */
export const CDL_ATTRIBUTES = [
  'label',
  'help',
  'required',
  'default',
  'readOnly',
  'hidden',
  'visibleWhen',
  'pattern',
  'message',
  'min',
  'max',
  'maxLength',
  'maxChars',
  'mimeTypes',
  'assetTypes',
  'folder',
  'options',
  'format',
  'features',
  'renamedFrom',
  'allow',
  'dataset',
  'sources',
  'pageSize',
  'maxPageSize',
  'sort',
  'localizable',
  'on',
  'off',
  'level',
  'scope',
  'when',
  'assert',
  'locales',
  'onGeneration',
  'requiredWhen',
  'readOnlyWhen',
  'value',
  'mode',
] as const;

/** Fixed values: levels, scopes, generation behavior, fill modes, locale selectors, whole-definition targets. */
export const CDL_VALUES = [
  'hint',
  'info',
  'warning',
  'error',
  'edit',
  'save',
  'release',
  'generation',
  'holdBack',
  'fail',
  'empty',
  'always',
  'all',
  'page',
  'section',
  'record',
  'global',
  'true',
  'false',
] as const;

/** Attributes whose string is an expression (highlighted and completed as one). */
export const CDL_EXPRESSION_KEYS = ['visibleWhen', 'when', 'assert', 'requiredWhen', 'readOnlyWhen', 'value'] as const;

/** A function of the expression language, with its signature and what it does. */
export interface ExpressionFunction {
  name: string;
  signature: string;
  info: string;
}

export const EXPRESSION_FUNCTIONS: readonly ExpressionFunction[] = [
  { name: 'length', signature: 'length(value)', info: 'Characters of a text (tags stripped), items of a list.' },
  { name: 'isEmpty', signature: 'isEmpty(value)', info: 'True for null, blank text, an empty list or object.' },
  { name: 'count', signature: 'count(list)', info: 'Number of items.' },
  { name: 'matches', signature: 'matches(text, regex)', info: 'Whether the text matches the regular expression.' },
  { name: 'lower', signature: 'lower(text)', info: 'Lower case.' },
  { name: 'upper', signature: 'upper(text)', info: 'Upper case.' },
  { name: 'trim', signature: 'trim(text)', info: 'Without leading and trailing white space.' },
  { name: 'substring', signature: 'substring(text, start, end?)', info: 'Part of a text.' },
  { name: 'concat', signature: 'concat(a, b, …)', info: 'Texts joined.' },
  { name: 'slugify', signature: 'slugify(text)', info: 'URL-safe lower-case words joined by hyphens.' },
  { name: 'stripTags', signature: 'stripTags(html)', info: 'Text without HTML tags.' },
  { name: 'wordCount', signature: 'wordCount(text)', info: 'Number of words.' },
  { name: 'now', signature: 'now()', info: 'The current date and time.' },
  { name: 'today', signature: 'today()', info: "Today's date." },
  { name: 'date', signature: 'date(text)', info: 'A date or date-time from ISO text.' },
  { name: 'daysBetween', signature: 'daysBetween(from, to)', info: 'Days from one date to another.' },
  { name: 'min', signature: 'min(a, b, … | list)', info: 'Smallest value.' },
  { name: 'max', signature: 'max(a, b, … | list)', info: 'Largest value.' },
  { name: 'sum', signature: 'sum(a, b, … | list)', info: 'Sum of numbers.' },
  { name: 'any', signature: 'any(list, condition)', info: 'Whether the condition holds for some item (`it`).' },
  { name: 'all', signature: 'all(list, condition)', info: 'Whether the condition holds for every item (`it`).' },
  { name: 'sections', signature: "sections(body, 'templateUid'?)", info: 'Section instances of a body (page rules).' },
  { name: 'ref', signature: 'ref(value)', info: 'The referenced asset: uid, name, path, content, meta, release.' },
];

/** Context names an expression can read besides the editors. */
export const EXPRESSION_CONTEXT = [
  'value',
  'item',
  'index',
  'parent',
  'it',
  'locale',
  'defaultLocale',
  'release',
  'page',
  'section',
  'record',
  'global',
  'body',
] as const;

/** Word operators and literals of the expression language. */
export const EXPRESSION_WORDS = ['and', 'or', 'not', 'in', 'true', 'false', 'null'] as const;

/** An OCTL instruction and what to insert for it. */
export interface OctlInstruction {
  name: string;
  /** The text completed after `$`. */
  snippet: string;
  info: string;
}

export const OCTL_INSTRUCTIONS: readonly OctlInstruction[] = [
  { name: 'CMS_VALUE', snippet: 'CMS_VALUE()$', info: 'Output a value: an editor, a variable, page:/media:/global:…' },
  { name: 'CMS_REF', snippet: 'CMS_REF()$', info: 'URL of a page or media file.' },
  { name: 'CMS_IF', snippet: 'CMS_IF()$', info: 'Conditional block, closed by $CMS_END_IF$.' },
  { name: 'CMS_ELSEIF', snippet: 'CMS_ELSEIF()$', info: 'Further condition inside $CMS_IF$.' },
  { name: 'CMS_ELSE', snippet: 'CMS_ELSE$', info: 'Otherwise branch.' },
  { name: 'CMS_END_IF', snippet: 'CMS_END_IF$', info: 'Ends $CMS_IF$.' },
  { name: 'CMS_FOR', snippet: 'CMS_FOR(item : )$', info: 'Loop, closed by $CMS_END_FOR$.' },
  { name: 'CMS_END_FOR', snippet: 'CMS_END_FOR$', info: 'Ends $CMS_FOR$.' },
  { name: 'CMS_SET', snippet: 'CMS_SET(name = )$', info: 'Set a variable.' },
  { name: 'CMS_INCLUDE', snippet: 'CMS_INCLUDE()$', info: 'Include a section template.' },
  { name: 'CMS_BODY', snippet: 'CMS_BODY()$', info: "Render a body's sections." },
  { name: 'CMS_NAVIGATION', snippet: 'CMS_NAVIGATION()$', info: 'Render a navigation folder.' },
  { name: 'CMS_END_NAVIGATION', snippet: 'CMS_END_NAVIGATION$', info: 'Ends a $CMS_NAVIGATION$ block.' },
  { name: 'CMS_NAVIGATION_RECURSE', snippet: 'CMS_NAVIGATION_RECURSE$', info: 'Render the children of a node.' },
  { name: 'CMS_PAGINATION', snippet: 'CMS_PAGINATION()$', info: 'Pagination links of a paginated page.' },
  { name: 'CMS_EXTENDS', snippet: 'CMS_EXTENDS()$', info: 'Extend a parent template.' },
  { name: 'CMS_BLOCK', snippet: 'CMS_BLOCK()$', info: 'Overridable block, closed by $CMS_END_BLOCK$.' },
  { name: 'CMS_END_BLOCK', snippet: 'CMS_END_BLOCK$', info: 'Ends $CMS_BLOCK$.' },
  { name: 'CMS_PARENT', snippet: 'CMS_PARENT$', info: "The parent template's block content." },
  { name: 'CMS_COMMENT', snippet: 'CMS_COMMENT$', info: 'Comment, closed by $CMS_END_COMMENT$.' },
  { name: 'CMS_END_COMMENT', snippet: 'CMS_END_COMMENT$', info: 'Ends $CMS_COMMENT$.' },
];

/** Names an OCTL expression can read besides the template's editors. */
export const OCTL_ROOTS = ['CMS_PAGE', 'CMS_META', 'CMS_GLOBAL', 'CMS_LOCALES', '_first', '_last', '_index'] as const;

/** Reference prefixes (`page:home`). */
export const OCTL_PREFIXES = ['page:', 'media:', 'record:', 'global:', 'nav:', 'dataset:', 'set:'] as const;

/** Operators and words of OCTL expressions (`$CMS_IF`, record set `where`). */
export const OCTL_WORDS = ['in', 'contains', 'startsWith', 'true', 'false', 'null'] as const;
