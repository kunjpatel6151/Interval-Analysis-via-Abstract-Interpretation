import {
  Program,
  Stmt,
  Expr,
  Cond,
  VarDeclStmt,
  ArrayDeclStmt,
  AssignStmt,
  ArrayStoreStmt,
  IfStmt,
  WhileStmt,
  AssertStmt,
  BlockStmt,
} from './ast';

export interface TraceRecord {
  line: number;
  vars: Record<string, number>;
  arrays: Record<string, number[]>;
}

export interface InterpreterOptions {
  inputProvider?: (min: number, max: number) => number;
  maxSteps?: number;
}

export type RuntimeErrorKind =
  | 'div-by-zero'
  | 'array-bounds'
  | 'overflow'
  | 'assertion'
  | 'unreachable';

export class RuntimeError extends Error {
  constructor(
    message: string,
    public line: number,
    public kind: RuntimeErrorKind = 'unreachable'
  ) {
    super(`Runtime Error [line ${line}]: ${message}`);
    this.name = 'RuntimeError';
  }
}

export class ConcreteInterpreter {
  private vars = new Map<string, number>();
  private arrays = new Map<string, number[]>();
  private trace: TraceRecord[] = [];
  private stepCount = 0;
  private maxSteps: number;
  private inputProvider: (min: number, max: number) => number;

  constructor(options: InterpreterOptions = {}) {
    this.maxSteps = options.maxSteps ?? 10000;
    this.inputProvider =
      options.inputProvider ??
      ((min, max) => Math.floor(Math.random() * (max - min + 1)) + min);
  }

  public run(program: Program): {
    vars: Record<string, number>;
    arrays: Record<string, number[]>;
    trace: TraceRecord[];
  } {
    this.vars.clear();
    this.arrays.clear();
    this.trace = [];
    this.stepCount = 0;

    for (const stmt of program.stmts) {
      this.execStmt(stmt);
    }

    return {
      vars: this.getVarsSnapshot(),
      arrays: this.getArraysSnapshot(),
      trace: this.trace,
    };
  }

  private execStmt(stmt: Stmt): void {
    this.stepCount++;
    if (this.stepCount > this.maxSteps) {
      throw new RuntimeError(`Execution exceeded maximum step limit of ${this.maxSteps}`, stmt.loc.line);
    }

    switch (stmt.kind) {
      case 'VarDecl':
        this.execVarDecl(stmt);
        break;
      case 'ArrayDecl':
        this.execArrayDecl(stmt);
        break;
      case 'Assign':
        this.execAssign(stmt);
        break;
      case 'ArrayStore':
        this.execArrayStore(stmt);
        break;
      case 'If':
        this.execIf(stmt);
        break;
      case 'While':
        this.execWhile(stmt);
        break;
      case 'Assert':
        this.execAssert(stmt);
        break;
      case 'Block':
        this.execBlock(stmt);
        break;
    }
  }

  private recordTrace(line: number): void {
    this.trace.push({
      line,
      vars: this.getVarsSnapshot(),
      arrays: this.getArraysSnapshot(),
    });
  }

  private getVarsSnapshot(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [k, v] of this.vars.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  private getArraysSnapshot(): Record<string, number[]> {
    const obj: Record<string, number[]> = {};
    for (const [k, v] of this.arrays.entries()) {
      obj[k] = [...v];
    }
    return obj;
  }

  private execVarDecl(stmt: VarDeclStmt): void {
    const val = stmt.init ? this.evalExpr(stmt.init) : 0;
    this.vars.set(stmt.name, val);
    this.recordTrace(stmt.loc.line);
  }

  private execArrayDecl(stmt: ArrayDeclStmt): void {
    this.arrays.set(stmt.name, new Array(stmt.size).fill(0));
    this.recordTrace(stmt.loc.line);
  }

  private execAssign(stmt: AssignStmt): void {
    const val = this.evalExpr(stmt.value);
    this.vars.set(stmt.name, val);
    this.recordTrace(stmt.loc.line);
  }

  private execArrayStore(stmt: ArrayStoreStmt): void {
    const idx = this.evalExpr(stmt.index);
    const arr = this.arrays.get(stmt.name);
    if (!arr) {
      throw new RuntimeError(`Undefined array '${stmt.name}'`, stmt.loc.line);
    }
    if (idx < 0 || idx >= arr.length) {
      throw new RuntimeError(
        `Array index out of bounds: index ${idx} for array '${stmt.name}' of length ${arr.length}`,
        stmt.loc.line,
        'array-bounds'
      );
    }
    const val = this.evalExpr(stmt.value);
    arr[idx] = val;
    this.recordTrace(stmt.loc.line);
  }

  private execIf(stmt: IfStmt): void {
    this.recordTrace(stmt.loc.line);
    const condVal = this.evalCond(stmt.cond);
    if (condVal) {
      this.execBlock(stmt.thenBlock);
    } else if (stmt.elseBlock) {
      this.execBlock(stmt.elseBlock);
    }
  }

  private execWhile(stmt: WhileStmt): void {
    this.recordTrace(stmt.loc.line);
    while (this.evalCond(stmt.cond)) {
      this.execBlock(stmt.body);
      this.recordTrace(stmt.loc.line);
    }
  }

  private execAssert(stmt: AssertStmt): void {
    this.recordTrace(stmt.loc.line);
    const condVal = this.evalCond(stmt.cond);
    if (!condVal) {
      throw new RuntimeError('Assertion failed', stmt.loc.line, 'assertion');
    }
  }

  private execBlock(stmt: BlockStmt): void {
    for (const child of stmt.stmts) {
      this.execStmt(child);
    }
  }

  public evalExpr(expr: Expr): number {
    switch (expr.kind) {
      case 'IntLiteral':
        return expr.value;
      case 'Var': {
        const val = this.vars.get(expr.name);
        if (val === undefined) {
          throw new RuntimeError(`Use of uninitialized variable '${expr.name}'`, expr.loc.line);
        }
        return val;
      }
      case 'ArrayAccess': {
        const arr = this.arrays.get(expr.name);
        if (!arr) {
          throw new RuntimeError(`Undefined array '${expr.name}'`, expr.loc.line);
        }
        const idx = this.evalExpr(expr.index);
        if (idx < 0 || idx >= arr.length) {
          throw new RuntimeError(
            `Array index out of bounds: index ${idx} for array '${expr.name}' of length ${arr.length}`,
            expr.loc.line,
            'array-bounds'
          );
        }
        return arr[idx];
      }
      case 'Unary': {
        const val = -this.evalExpr(expr.expr);
        if (val < -2147483648 || val > 2147483647) {
          throw new RuntimeError('Int32 overflow', expr.loc.line, 'overflow');
        }
        return val;
      }
      case 'Binary': {
        const l = this.evalExpr(expr.left);
        const r = this.evalExpr(expr.right);
        switch (expr.op) {
          case '+': {
            const val = l + r;
            if (val < -2147483648 || val > 2147483647) {
              throw new RuntimeError('Int32 overflow', expr.loc.line, 'overflow');
            }
            return Math.trunc(val);
          }
          case '-': {
            const val = l - r;
            if (val < -2147483648 || val > 2147483647) {
              throw new RuntimeError('Int32 overflow', expr.loc.line, 'overflow');
            }
            return Math.trunc(val);
          }
          case '*': {
            const val = l * r;
            if (val < -2147483648 || val > 2147483647) {
              throw new RuntimeError('Int32 overflow', expr.loc.line, 'overflow');
            }
            return Math.trunc(val);
          }
          case '/':
            if (r === 0) {
              throw new RuntimeError('Division by zero', expr.loc.line, 'div-by-zero');
            }
            return Math.trunc(l / r);
        }
      }
      case 'Input':
        return this.inputProvider(expr.min, expr.max);
    }
  }

  public evalCond(cond: Cond): boolean {
    switch (cond.kind) {
      case 'CompareCond': {
        const l = this.evalExpr(cond.left);
        const r = this.evalExpr(cond.right);
        switch (cond.op) {
          case '<':
            return l < r;
          case '<=':
            return l <= r;
          case '>':
            return l > r;
          case '>=':
            return l >= r;
          case '==':
            return l === r;
          case '!=':
            return l !== r;
        }
      }
      case 'LogicalCond': {
        if (cond.op === '&&') {
          return this.evalCond(cond.left) && this.evalCond(cond.right);
        } else {
          return this.evalCond(cond.left) || this.evalCond(cond.right);
        }
      }
      case 'NotCond':
        return !this.evalCond(cond.expr);
    }
  }
}
