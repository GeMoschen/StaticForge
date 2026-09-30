/**
 * The request fields of a CDL definition written as one text (M34): templates, datasets and global sets take their
 * CDL as `contentCdl`, `bodiesCdl` and `rulesCdl` — the text inside each section's braces. Journeys keep writing
 * `content { … } bodies { … } rules { … }` and spread `...cdl(text)` into the request body.
 */
export function cdl(text: string): { contentCdl: string; bodiesCdl: string; rulesCdl: string } {
  const sections: Record<string, string[]> = { content: [], bodies: [], rules: [] };
  let i = 0;
  while (i < text.length) {
    const head = /^\s*(content|bodies|rules)\s*\{/.exec(text.slice(i));
    if (!head) {
      i++;
      continue;
    }
    const open = i + head[0].length;
    let depth = 1;
    let j = open;
    for (; j < text.length && depth > 0; j++) {
      const c = text[j];
      if (c === '"') {
        for (j++; j < text.length && text[j] !== '"'; j++) {
          if (text[j] === '\\') {
            j++;
          }
        }
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
      }
    }
    sections[head[1]].push(text.slice(open, j - 1).trim());
    i = j;
  }
  return {
    contentCdl: sections['content'].join('\n'),
    bodiesCdl: sections['bodies'].join('\n'),
    rulesCdl: sections['rules'].join('\n'),
  };
}
