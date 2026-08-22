#!/usr/bin/env node
/**
 * Renames component stylesheets from .css to .scss and updates the
 * corresponding `styleUrl: './x.component.css'` reference in each
 * component's .ts file. Angular already treats external .scss files as
 * Sass (angular.json has no special config needed beyond the file
 * extension); this only touches component-local stylesheets, not
 * src/styles.scss which is already Sass.
 *
 * Usage: node scripts/css-to-scss.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const rootDir = path.resolve('src/app');

function findCssFiles(dir) {
  const entries = fs.readdirSync(dir, { recursive: true });
  const files = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    if (!entry.endsWith('.component.css')) continue;
    files.push(path.join(dir, entry));
  }
  return files;
}

function main() {
  const cssFiles = findCssFiles(rootDir).sort();
  let renamed = 0;

  for (const cssPath of cssFiles) {
    const scssPath = cssPath.replace(/\.css$/, '.scss');
    const tsPath = cssPath.replace(/\.component\.css$/, '.component.ts');
    const relCss = path.relative(process.cwd(), cssPath);
    const relTs = path.relative(process.cwd(), tsPath);

    if (!fs.existsSync(tsPath)) {
      console.log(`skip  ${relCss}  (no matching .ts file: ${relTs})`);
      continue;
    }

    const tsSource = fs.readFileSync(tsPath, 'utf8');
    const cssBase = path.basename(cssPath);
    const scssBase = path.basename(scssPath);
    const needle = `styleUrl: './${cssBase}'`;
    const replacement = `styleUrl: './${scssBase}'`;

    if (!tsSource.includes(needle)) {
      console.log(`skip  ${relCss}  (no "${needle}" found in ${relTs})`);
      continue;
    }

    console.log(`${dryRun ? 'would rename' : 'rename'}  ${relCss}  ->  ${path.basename(scssPath)}`);

    if (!dryRun) {
      fs.renameSync(cssPath, scssPath);
      fs.writeFileSync(tsPath, tsSource.replace(needle, replacement), 'utf8');
    }
    renamed++;
  }

  console.log(`\n${renamed} renamed, ${cssFiles.length - renamed} skipped, ${cssFiles.length} total${dryRun ? ' (dry run)' : ''}`);
}

main();
