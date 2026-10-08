/**
 * Source Location information attached to AST nodes for precise reporting and annotations.
 */
export interface SourceLocation {
  line: number;
  col: number;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export interface BinaryExpr {
  kind: 'Binary';
  op: '+' | '-' | '*' | '/';
  left: Expr;
  right: Expr;
  loc: SourceLocation;
}

export interface UnaryExpr {
  kind: 'Unary';
  op: '-';
  expr: Expr;
  loc: SourceLocation;
}

export interface IntLiteralExpr {
  kind: 'IntLiteral';
  value: number;
  loc: SourceLocation;
}

export interface VarExpr {
  kind: 'Var';
  name: string;
  loc: SourceLocation;
}

export interface ArrayAccessExpr {
  kind: 'ArrayAccess';
  name: string;
  index: Expr;
  loc: SourceLocation;
}

export interface InputExpr {
  kind: 'Input';
  min: number;
  max: number;
  loc: SourceLocation;
}

export type Expr =
  | BinaryExpr
  | UnaryExpr
  | IntLiteralExpr
  | VarExpr
  | ArrayAccessExpr
  | InputExpr;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type LogicalOp = '&&' | '||';

export interface CompareCond {
  kind: 'CompareCond';
  op: CompareOp;
  left: Expr;
  right: Expr;
  loc: SourceLocation;
}

export interface LogicalCond {
  kind: 'LogicalCond';
  op: LogicalOp;
  left: Cond;
  right: Cond;
  loc: SourceLocation;
}

export interface NotCond {
  kind: 'NotCond';
  expr: Cond;
  loc: SourceLocation;
}

export type Cond = CompareCond | LogicalCond | NotCond;

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface VarDeclStmt {
  kind: 'VarDecl';
  name: string;
  init?: Expr;
  loc: SourceLocation;
}

export interface ArrayDeclStmt {
  kind: 'ArrayDecl';
  name: string;
  size: number;
  loc: SourceLocation;
}

export interface AssignStmt {
  kind: 'Assign';
  name: string;
  value: Expr;
  loc: SourceLocation;
}

export interface ArrayStoreStmt {
  kind: 'ArrayStore';
  name: string;
  index: Expr;
  value: Expr;
  loc: SourceLocation;
}

export interface BlockStmt {
  kind: 'Block';
  stmts: Stmt[];
  loc: SourceLocation;
}

export interface IfStmt {
  kind: 'If';
  cond: Cond;
  thenBlock: BlockStmt;
  elseBlock?: BlockStmt;
  loc: SourceLocation;
}

export interface WhileStmt {
  kind: 'While';
  cond: Cond;
  body: BlockStmt;
  loc: SourceLocation;
}

export interface AssertStmt {
  kind: 'Assert';
  cond: Cond;
  loc: SourceLocation;
}

export type Stmt =
  | VarDeclStmt
  | ArrayDeclStmt
  | AssignStmt
  | ArrayStoreStmt
  | BlockStmt
  | IfStmt
  | WhileStmt
  | AssertStmt;

export interface Program {
  stmts: Stmt[];
}
