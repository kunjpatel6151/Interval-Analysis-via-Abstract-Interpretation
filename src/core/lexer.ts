export type TokenType =
  | 'KW_INT'
  | 'KW_IF'
  | 'KW_ELSE'
  | 'KW_WHILE'
  | 'KW_ASSERT'
  | 'KW_INPUT'
  | 'ID'
  | 'INT'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'ASSIGN'
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'SEMI'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'LBRACK'
  | 'RBRACK'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

export class LexerError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`Lexer Error [${line}:${col}]: ${message}`);
    this.name = 'LexerError';
  }
}

const KEYWORDS: Record<string, TokenType> = {
  int: 'KW_INT',
  if: 'KW_IF',
  else: 'KW_ELSE',
  while: 'KW_WHILE',
  assert: 'KW_ASSERT',
  input: 'KW_INPUT',
};

export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private input: string) {}

  public tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      // Skip whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
        continue;
      }

      if (ch === '\n') {
        this.line++;
        this.col = 1;
        this.pos++;
        continue;
      }

      // Comments: // ...
      if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.advance();
        }
        continue;
      }

      const startLine = this.line;
      const startCol = this.col;

      // Numbers
      if (this.isDigit(ch)) {
        let numStr = '';
        while (this.pos < this.input.length && this.isDigit(this.input[this.pos])) {
          numStr += this.input[this.pos];
          this.advance();
        }
        tokens.push({ type: 'INT', value: numStr, line: startLine, col: startCol });
        continue;
      }

      // Identifiers / Keywords
      if (this.isAlpha(ch) || ch === '_') {
        let idStr = '';
        while (
          this.pos < this.input.length &&
          (this.isAlphaNumeric(this.input[this.pos]) || this.input[this.pos] === '_')
        ) {
          idStr += this.input[this.pos];
          this.advance();
        }

        const kwType = KEYWORDS[idStr];
        if (kwType) {
          tokens.push({ type: kwType, value: idStr, line: startLine, col: startCol });
        } else {
          tokens.push({ type: 'ID', value: idStr, line: startLine, col: startCol });
        }
        continue;
      }

      // Operators and punctuation
      switch (ch) {
        case '+':
          tokens.push({ type: 'PLUS', value: '+', line: startLine, col: startCol });
          this.advance();
          break;
        case '-':
          tokens.push({ type: 'MINUS', value: '-', line: startLine, col: startCol });
          this.advance();
          break;
        case '*':
          tokens.push({ type: 'STAR', value: '*', line: startLine, col: startCol });
          this.advance();
          break;
        case '/':
          tokens.push({ type: 'SLASH', value: '/', line: startLine, col: startCol });
          this.advance();
          break;
        case '=':
          if (this.peek(1) === '=') {
            tokens.push({ type: 'EQ', value: '==', line: startLine, col: startCol });
            this.advance();
            this.advance();
          } else {
            tokens.push({ type: 'ASSIGN', value: '=', line: startLine, col: startCol });
            this.advance();
          }
          break;
        case '!':
          if (this.peek(1) === '=') {
            tokens.push({ type: 'NEQ', value: '!=', line: startLine, col: startCol });
            this.advance();
            this.advance();
          } else {
            tokens.push({ type: 'NOT', value: '!', line: startLine, col: startCol });
            this.advance();
          }
          break;
        case '<':
          if (this.peek(1) === '=') {
            tokens.push({ type: 'LTE', value: '<=', line: startLine, col: startCol });
            this.advance();
            this.advance();
          } else {
            tokens.push({ type: 'LT', value: '<', line: startLine, col: startCol });
            this.advance();
          }
          break;
        case '>':
          if (this.peek(1) === '=') {
            tokens.push({ type: 'GTE', value: '>=', line: startLine, col: startCol });
            this.advance();
            this.advance();
          } else {
            tokens.push({ type: 'GT', value: '>', line: startLine, col: startCol });
            this.advance();
          }
          break;
        case '&':
          if (this.peek(1) === '&') {
            tokens.push({ type: 'AND', value: '&&', line: startLine, col: startCol });
            this.advance();
            this.advance();
          } else {
            throw new LexerError(`Unexpected character '&'. Did you mean '&&'?`, startLine, startCol);
          }
          break;
        case '|':
          if (this.peek(1) === '|') {
            tokens.push({ type: 'OR', value: '||', line: startLine, col: startCol });
            this.advance();
            this.advance();
          } else {
            throw new LexerError(`Unexpected character '|'. Did you mean '||'?`, startLine, startCol);
          }
          break;
        case ';':
          tokens.push({ type: 'SEMI', value: ';', line: startLine, col: startCol });
          this.advance();
          break;
        case ',':
          tokens.push({ type: 'COMMA', value: ',', line: startLine, col: startCol });
          this.advance();
          break;
        case '(':
          tokens.push({ type: 'LPAREN', value: '(', line: startLine, col: startCol });
          this.advance();
          break;
        case ')':
          tokens.push({ type: 'RPAREN', value: ')', line: startLine, col: startCol });
          this.advance();
          break;
        case '{':
          tokens.push({ type: 'LBRACE', value: '{', line: startLine, col: startCol });
          this.advance();
          break;
        case '}':
          tokens.push({ type: 'RBRACE', value: '}', line: startLine, col: startCol });
          this.advance();
          break;
        case '[':
          tokens.push({ type: 'LBRACK', value: '[', line: startLine, col: startCol });
          this.advance();
          break;
        case ']':
          tokens.push({ type: 'RBRACK', value: ']', line: startLine, col: startCol });
          this.advance();
          break;
        default:
          throw new LexerError(`Unexpected character '${ch}'`, startLine, startCol);
      }
    }

    tokens.push({ type: 'EOF', value: '', line: this.line, col: this.col });
    return tokens;
  }

  private advance(): void {
    this.pos++;
    this.col++;
  }

  private peek(offset = 0): string {
    if (this.pos + offset >= this.input.length) return '';
    return this.input[this.pos + offset];
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}
