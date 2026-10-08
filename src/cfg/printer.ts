import { Expr, Cond } from '../core/ast';
import { Action, CFG } from './types';

/**
 * Format an AST expression into a readable string.
 */
export function prettyPrintExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'IntLiteral':
      return expr.value.toString();
    case 'Var':
      return expr.name;
    case 'ArrayAccess':
      return `${expr.name}[${prettyPrintExpr(expr.index)}]`;
    case 'Input':
      return `input(${expr.min}, ${expr.max})`;
    case 'Unary':
      return `-${prettyPrintExpr(expr.expr)}`;
    case 'Binary': {
      const leftStr = expr.left.kind === 'Binary' && needsParens(expr.op, expr.left.op, true)
        ? `(${prettyPrintExpr(expr.left)})`
        : prettyPrintExpr(expr.left);
      const rightStr = expr.right.kind === 'Binary' && needsParens(expr.op, expr.right.op, false)
        ? `(${prettyPrintExpr(expr.right)})`
        : prettyPrintExpr(expr.right);
      return `${leftStr} ${expr.op} ${rightStr}`;
    }
  }
}

function precedence(op: '+' | '-' | '*' | '/'): number {
  return op === '*' || op === '/' ? 2 : 1;
}

function needsParens(
  parentOp: '+' | '-' | '*' | '/',
  childOp: '+' | '-' | '*' | '/',
  isLeft: boolean
): boolean {
  const pParent = precedence(parentOp);
  const pChild = precedence(childOp);
  if (pChild < pParent) return true;
  if (pChild === pParent && !isLeft && (parentOp === '-' || parentOp === '/')) return true;
  return false;
}

/**
 * Format an AST condition into a readable string.
 */
export function prettyPrintCond(cond: Cond): string {
  switch (cond.kind) {
    case 'CompareCond':
      return `${prettyPrintExpr(cond.left)} ${cond.op} ${prettyPrintExpr(cond.right)}`;
    case 'NotCond':
      return `!(${prettyPrintCond(cond.expr)})`;
    case 'LogicalCond':
      return `${prettyPrintCond(cond.left)} ${cond.op} ${prettyPrintCond(cond.right)}`;
  }
}

/**
 * Format an action into a clean label.
 */
export function prettyPrintAction(action: Action): string {
  switch (action.kind) {
    case 'skip':
      return 'skip';
    case 'decl':
      return action.init
        ? `int ${action.name} = ${prettyPrintExpr(action.init)}`
        : `int ${action.name}`;
    case 'arrayDecl':
      return `int ${action.name}[${action.size}]`;
    case 'assign':
      return `${action.name} = ${prettyPrintExpr(action.expr)}`;
    case 'store':
      return `${action.array}[${prettyPrintExpr(action.index)}] = ${prettyPrintExpr(action.expr)}`;
    case 'assume':
      return action.negated
        ? `[!(${prettyPrintCond(action.cond)})]`
        : `[${prettyPrintCond(action.cond)}]`;
    case 'assert':
      return `assert(${prettyPrintCond(action.cond)})`;
  }
}

/**
 * Human-readable list of CFG edges.
 */
export function prettyPrint(cfg: CFG): string {
  const lines: string[] = [];
  lines.push(`CFG (Entry: ${cfg.entry}, Exit: ${cfg.exit}, LoopHeads: [${cfg.loopHeads.join(', ')}])`);
  for (const edge of cfg.edges) {
    const label = prettyPrintAction(edge.action);
    lines.push(`  N${edge.from} -> N${edge.to} : ${label} (line ${edge.line})`);
  }
  return lines.join('\n');
}

/**
 * Generate Graphviz DOT representation of CFG.
 */
export function toDot(cfg: CFG): string {
  const lines: string[] = [];
  lines.push('digraph CFG {');
  lines.push('  rankdir=TB;');
  lines.push('  node [fontname="Courier", fontsize=11, shape=circle];');
  lines.push('  edge [fontname="Courier", fontsize=10];');
  lines.push('');

  // Nodes
  for (const node of cfg.nodes) {
    const attrs: string[] = [];
    let label = `N${node.id}`;
    if (node.id === cfg.entry) label += '\\n(entry)';
    if (node.id === cfg.exit) label += '\\n(exit)';
    if (node.isLoopHead) {
      label += '\\n[loop head]';
      attrs.push('shape=doublecircle', 'color=blue', 'penwidth=2');
    }
    attrs.push(`label="${label}"`);
    lines.push(`  ${node.id} [${attrs.join(', ')}];`);
  }

  lines.push('');

  // Edges
  for (const edge of cfg.edges) {
    const rawLabel = prettyPrintAction(edge.action);
    const escaped = rawLabel.replace(/"/g, '\\"');
    const label = `${escaped} (L${edge.line})`;
    lines.push(`  ${edge.from} -> ${edge.to} [label="${label}"];`);
  }

  lines.push('}');
  return lines.join('\n');
}
