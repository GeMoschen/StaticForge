/**
 * A faithful TypeScript port of the backend {@code visibleWhen} expression
 * grammar (see `server/sf-template/.../template/expression/ExpressionEvaluator.java`,
 * spec §14.4). Shared semantic behaviour is pinned by the shared fixture file
 * `expression.fixtures.json`, consumed identically by the backend content
 * validator and this Angular form engine.
 *
 * Grammar:
 *   expr      := or
 *   or        := and ('||' and)*
 *   and       := not ('&&' not)*
 *   not       := '!' not | comparison
 *   comparison:= atom (op atom)?           // bare atom is a truthiness test
 *   op        := '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in'
 *   atom      := identifier | string | number | 'true' | 'false' | 'null'
 *              | '(' or ')' | '[' (atom (',' atom)*)? ']'
 */
type TokenType =
  | 'IDENT'
  | 'STRING'
  | 'NUMBER'
  | 'BOOL'
  | 'NULL'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'LT'
  | 'GTE'
  | 'LTE'
  | 'IN'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'EOF';

interface Token {
  type: TokenType;
  text: string;
}

function isWhitespace(c: string): boolean {
  return /\s/.test(c);
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (isWhitespace(c)) {
      i++;
    } else if (c === '(') {
      tokens.push({ type: 'LPAREN', text: '(' });
      i++;
    } else if (c === ')') {
      tokens.push({ type: 'RPAREN', text: ')' });
      i++;
    } else if (c === '[') {
      tokens.push({ type: 'LBRACKET', text: '[' });
      i++;
    } else if (c === ']') {
      tokens.push({ type: 'RBRACKET', text: ']' });
      i++;
    } else if (c === ',') {
      tokens.push({ type: 'COMMA', text: ',' });
      i++;
    } else if (c === '=') {
      tokens.push({ type: 'EQ', text: '==' });
      i += 2;
    } else if (c === '!' && i + 1 < n && input[i + 1] === '=') {
      tokens.push({ type: 'NEQ', text: '!=' });
      i += 2;
    } else if (c === '!') {
      tokens.push({ type: 'NOT', text: '!' });
      i++;
    } else if (c === '&' && i + 1 < n && input[i + 1] === '&') {
      tokens.push({ type: 'AND', text: '&&' });
      i += 2;
    } else if (c === '|' && i + 1 < n && input[i + 1] === '|') {
      tokens.push({ type: 'OR', text: '||' });
      i += 2;
    } else if (c === '>' && i + 1 < n && input[i + 1] === '=') {
      tokens.push({ type: 'GTE', text: '>=' });
      i += 2;
    } else if (c === '<' && i + 1 < n && input[i + 1] === '=') {
      tokens.push({ type: 'LTE', text: '<=' });
      i += 2;
    } else if (c === '>') {
      tokens.push({ type: 'GT', text: '>' });
      i++;
    } else if (c === '<') {
      tokens.push({ type: 'LT', text: '<' });
      i++;
    } else if (c === '"' || c === "'") {
      const start = ++i;
      while (i < n && input[i] !== c) {
        i++;
      }
      tokens.push({ type: 'STRING', text: input.slice(start, i) });
      i++;
    } else if (isDigit(c) || c === '-' || c === '.') {
      const start = i;
      while (i < n && (isDigit(input[i]) || input[i] === '.' || input[i] === '-')) {
        i++;
      }
      tokens.push({ type: 'NUMBER', text: input.slice(start, i) });
    } else if (isLetter(c) || c === '_') {
      const start = i;
      while (
        i < n &&
        (isLetter(input[i]) || isDigit(input[i]) || input[i] === '_' || input[i] === '.')
      ) {
        i++;
      }
      const word = input.slice(start, i);
      let type: TokenType = 'IDENT';
      if (word === 'true' || word === 'false') {
        type = 'BOOL';
      } else if (word === 'null') {
        type = 'NULL';
      } else if (word === 'in') {
        type = 'IN';
      }
      tokens.push({ type, text: word });
    } else {
      throw new Error(`Unexpected character '${c}' in expression: ${input}`);
    }
  }
  tokens.push({ type: 'EOF', text: '' });
  return tokens;
}

function equalsNode(a: unknown, b: unknown): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  const as = String(a ?? '');
  const bs = String(b ?? '');
  return as === bs ? 0 : as < bs ? -1 : 1;
}

function inArray(array: unknown, value: unknown): boolean {
  if (Array.isArray(array)) {
    return array.some((element) => equalsNode(element, value));
  }
  if (typeof array === 'string') {
    return array.includes(String(value ?? ''));
  }
  return false;
}

function truthy(node: unknown): boolean {
  if (node == null) {
    return false;
  }
  if (typeof node === 'boolean') {
    return node;
  }
  if (typeof node === 'number') {
    return node !== 0;
  }
  if (typeof node === 'string') {
    return node.length > 0;
  }
  if (Array.isArray(node)) {
    return node.length > 0;
  }
  if (typeof node === 'object') {
    return Object.keys(node).length > 0;
  }
  return true;
}

function scopeValue(scope: Record<string, unknown>, identifier: string): unknown {
  if (scope == null) {
    return null;
  }
  let node: unknown = scope;
  for (const part of identifier.split('.')) {
    if (node == null || typeof node !== 'object') {
      return null;
    }
    const obj = node as Record<string, unknown>;
    if (!(part in obj)) {
      return null;
    }
    node = obj[part];
  }
  return node === undefined ? null : node;
}

function compare(op: TokenType, left: unknown, right: unknown): boolean {
  switch (op) {
    case 'EQ':
      return equalsNode(left, right);
    case 'NEQ':
      return !equalsNode(left, right);
    case 'GT':
      return cmp(left, right) > 0;
    case 'LT':
      return cmp(left, right) < 0;
    case 'GTE':
      return cmp(left, right) >= 0;
    case 'LTE':
      return cmp(left, right) <= 0;
    case 'IN':
      return inArray(right, left);
    default:
      return false;
  }
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: Record<string, unknown>,
  ) {}

  parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peek().type === 'OR') {
      this.next();
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.peek().type === 'AND') {
      this.next();
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  private parseNot(): boolean {
    if (this.peek().type === 'NOT') {
      this.next();
      return !this.parseNot();
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.parseAtom();
    const op = this.peek();
    if (
      op.type === 'EQ' ||
      op.type === 'NEQ' ||
      op.type === 'GT' ||
      op.type === 'LT' ||
      op.type === 'GTE' ||
      op.type === 'LTE' ||
      op.type === 'IN'
    ) {
      this.next();
      const right =
        op.type === 'IN' && this.peek().type === 'LBRACKET'
          ? this.parseArray()
          : this.parseAtom();
      return compare(op.type, left, right);
    }
    return truthy(left);
  }

  private parseAtom(): unknown {
    const t = this.next();
    switch (t.type) {
      case 'IDENT':
        return scopeValue(this.scope, t.text);
      case 'STRING':
        return t.text;
      case 'NUMBER':
        return Number(t.text);
      case 'BOOL':
        return t.text === 'true';
      case 'NULL':
        return null;
      case 'LPAREN': {
        const v = this.parseOr();
        this.expect('RPAREN');
        return v;
      }
      default:
        throw new Error(`Unexpected token: ${t.type}`);
    }
  }

  private parseArray(): unknown[] {
    this.expect('LBRACKET');
    const array: unknown[] = [];
    if (this.peek().type === 'RBRACKET') {
      this.next();
      return array;
    }
    for (;;) {
      array.push(this.parseAtom());
      if (this.peek().type === 'COMMA') {
        this.next();
      } else {
        this.expect('RBRACKET');
        return array;
      }
    }
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  expect(type: TokenType): void {
    const t = this.next();
    if (t.type !== type) {
      throw new Error(`Expected ${type} but got ${t.type}`);
    }
  }
}

/**
 * Evaluates a {@code visibleWhen} expression against a scope object. Returns
 * `true` for empty/blank expressions, and throws on malformed input.
 */
export class ExpressionEvaluator {
  evaluate(expression: string, scope: Record<string, unknown>): boolean {
    if (expression == null || expression.trim() === '') {
      return true;
    }
    const parser = new Parser(tokenize(expression), scope);
    const result = parser.parseOr();
    parser.expect('EOF');
    return result;
  }

  /** Returns the identifiers referenced by the expression (used for grammar checks). */
  identifiers(expression: string): string[] {
    const ids: string[] = [];
    for (const token of tokenize(expression)) {
      if (token.type === 'IDENT' && !ids.includes(token.text)) {
        ids.push(token.text);
      }
    }
    return ids;
  }
}
