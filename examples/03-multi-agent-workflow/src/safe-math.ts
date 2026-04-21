/**
 * Safe math expression evaluator.
 * Parses and evaluates simple arithmetic expressions without using eval/new Function.
 * Supports: +, -, *, /, parentheses, decimal numbers.
 */

type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'PLUS' }
  | { type: 'MINUS' }
  | { type: 'MUL' }
  | { type: 'DIV' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'EOF' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/\d/.test(ch) || ch === '.') {
      let num = '';
      while (i < input.length && (/\d/.test(input[i]) || input[i] === '.')) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: Number(num) });
      continue;
    }
    switch (ch) {
      case '+':
        tokens.push({ type: 'PLUS' });
        break;
      case '-':
        tokens.push({ type: 'MINUS' });
        break;
      case '*':
        tokens.push({ type: 'MUL' });
        break;
      case '/':
        tokens.push({ type: 'DIV' });
        break;
      case '(':
        tokens.push({ type: 'LPAREN' });
        break;
      case ')':
        tokens.push({ type: 'RPAREN' });
        break;
      default:
        throw new Error(`Unexpected character: ${ch}`);
    }
    i++;
  }
  tokens.push({ type: 'EOF' });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private current(): Token {
    return this.tokens[this.pos];
  }

  private eat(type: Token['type']): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type}`);
    }
    this.pos++;
    return token;
  }

  parse(): number {
    const result = this.expr();
    this.eat('EOF');
    return result;
  }

  private expr(): number {
    let result = this.term();
    while (this.current().type === 'PLUS' || this.current().type === 'MINUS') {
      const op = this.current().type;
      this.pos++;
      const right = this.term();
      if (op === 'PLUS') result += right;
      else result -= right;
    }
    return result;
  }

  private term(): number {
    let result = this.factor();
    while (this.current().type === 'MUL' || this.current().type === 'DIV') {
      const op = this.current().type;
      this.pos++;
      const right = this.factor();
      if (op === 'MUL') result *= right;
      else {
        if (right === 0) throw new Error('Division by zero');
        result /= right;
      }
    }
    return result;
  }

  private factor(): number {
    const token = this.current();
    if (token.type === 'NUMBER') {
      this.pos++;
      return token.value;
    }
    if (token.type === 'LPAREN') {
      this.pos++;
      const result = this.expr();
      this.eat('RPAREN');
      return result;
    }
    if (token.type === 'MINUS') {
      this.pos++;
      return -this.factor();
    }
    throw new Error(`Unexpected token: ${token.type}`);
  }
}

export function safeEval(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
