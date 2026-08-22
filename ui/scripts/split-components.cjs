#!/usr/bin/env node
/**
 * Splits Angular @Component() decorators with inline `template`/`styles`
 * into external .html/.css files (templateUrl/styleUrl), leaving components
 * that already use templateUrl/styleUrl untouched.
 *
 * Usage:
 *   node scripts/split-components.cjs [--dry-run] [--dir src/app]
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirArgIdx = args.indexOf('--dir');
const rootDir = path.resolve(
  dirArgIdx !== -1 && args[dirArgIdx + 1] ? args[dirArgIdx + 1] : 'src/app',
);

/** Recursively collect *.component.ts files under rootDir. */
function findComponentFiles(dir) {
  const entries = fs.readdirSync(dir, { recursive: true });
  const files = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    if (!entry.endsWith('.component.ts')) continue;
    if (entry.endsWith('.spec.ts')) continue;
    files.push(path.join(dir, entry));
  }
  return files;
}

/** Get the string content of a template-literal-ish node, or null if unsupported. */
function literalText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
    return node.text;
  }
  return null; // TemplateExpression (has ${}) or something else we don't handle
}

/** Dedent a block of text: strip the largest common leading whitespace from non-blank lines. */
function dedent(text) {
  const lines = text.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = line.match(/^[ \t]*/);
    minIndent = Math.min(minIndent, match[0].length);
  }
  if (!isFinite(minIndent)) minIndent = 0;
  return lines.map((line) => line.slice(minIndent)).join('\n') + '\n';
}

function findComponentObjectLiteral(sourceFile) {
  let result = null;
  function visit(node) {
    if (result) return;
    if (ts.isClassDeclaration(node)) {
      const decorators = ts.getDecorators ? ts.getDecorators(node) : node.decorators;
      for (const dec of decorators ?? []) {
        if (!ts.isCallExpression(dec.expression)) continue;
        const callee = dec.expression.expression;
        if (ts.isIdentifier(callee) && callee.text === 'Component') {
          const arg = dec.expression.arguments[0];
          if (arg && ts.isObjectLiteralExpression(arg)) {
            result = arg;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}

function getIndent(sourceText, node) {
  const lineStart = sourceText.lastIndexOf('\n', node.getStart()) + 1;
  return sourceText.slice(lineStart, node.getStart()).match(/^[ \t]*/)[0];
}

/**
 * Process a single component file. Returns a report object describing what
 * happened (or would happen, in dry-run mode).
 */
function processFile(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const objLit = findComponentObjectLiteral(sourceFile);
  if (!objLit) {
    return { filePath, skipped: 'no @Component object literal found' };
  }

  const templateProp = objLit.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name && p.name.getText() === 'template',
  );
  const stylesProp = objLit.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name && p.name.getText() === 'styles',
  );

  if (!templateProp && !stylesProp) {
    return { filePath, skipped: 'already external (no inline template/styles)' };
  }

  const base = path.basename(filePath, '.ts');
  const dir = path.dirname(filePath);
  const htmlPath = path.join(dir, `${base}.html`);
  const cssPath = path.join(dir, `${base}.css`);

  const edits = []; // { start, end, text }
  const writes = []; // { path, content }

  if (templateProp) {
    const text = literalText(templateProp.initializer);
    if (text === null) {
      return { filePath, skipped: 'template is not a plain template literal (has ${} substitutions)' };
    }
    writes.push({ path: htmlPath, content: dedent(text) });
    const indent = getIndent(sourceText, templateProp);
    edits.push({
      start: templateProp.getStart(),
      end: templateProp.getEnd(),
      text: `templateUrl: './${base}.html'`,
    });
    void indent;
  }

  if (stylesProp) {
    const init = stylesProp.initializer;
    if (!ts.isArrayLiteralExpression(init)) {
      return { filePath, skipped: 'styles is not an array literal' };
    }
    const parts = [];
    for (const el of init.elements) {
      const text = literalText(el);
      if (text === null) {
        return { filePath, skipped: 'a styles[] entry is not a plain template literal' };
      }
      parts.push(dedent(text).replace(/\n+$/, ''));
    }
    const cssContent = parts.join('\n\n').replace(/\s+$/, '') + '\n';
    writes.push({ path: cssPath, content: cssContent });
    edits.push({
      start: stylesProp.getStart(),
      end: stylesProp.getEnd(),
      text: `styleUrl: './${base}.css'`,
    });
  }

  edits.sort((a, b) => a.start - b.start);
  let newSource = sourceText;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    newSource = newSource.slice(0, e.start) + e.text + newSource.slice(e.end);
  }

  if (!dryRun) {
    for (const w of writes) {
      fs.writeFileSync(w.path, w.content, 'utf8');
    }
    fs.writeFileSync(filePath, newSource, 'utf8');
  }

  return {
    filePath,
    wrote: writes.map((w) => w.path),
    updatedTs: true,
  };
}

function main() {
  if (!fs.existsSync(rootDir)) {
    console.error(`Directory not found: ${rootDir}`);
    process.exit(1);
  }
  const files = findComponentFiles(rootDir).sort();
  let split = 0;
  let skipped = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const result = processFile(file);
    if (result.skipped) {
      skipped++;
      console.log(`skip  ${rel}  (${result.skipped})`);
    } else {
      split++;
      console.log(`${dryRun ? 'would split' : 'split'}  ${rel}  ->  ${result.wrote.map((w) => path.basename(w)).join(', ')}`);
    }
  }

  console.log(`\n${split} split, ${skipped} skipped, ${files.length} total${dryRun ? ' (dry run, no files written)' : ''}`);
}

main();
