import { Program, Stmt, WhileStmt, IfStmt, BlockStmt } from '../core/ast';
import { CFG } from './types';
import { buildCFG } from './builder';

/**
 * Loop Unrolling Transformation:
 * Peels the first k iterations of each while loop.
 *
 * For k = 1:
 * while (C) { B }
 * becomes:
 * if (C) {
 *   B;
 *   while (C) { B }
 * }
 *
 * All unrolled nodes and edges preserve the exact source line numbers of the
 * original loop and statements so that visualizer annotations and error reporting
 * map back transparently to source lines.
 */
export function unrollProgram(program: Program, k: number): Program {
  if (k <= 0) return program;

  function unrollStmt(stmt: Stmt): Stmt[] {
    if (stmt.kind === 'While') {
      return unrollWhile(stmt, k);
    }
    if (stmt.kind === 'If') {
      const newThen: BlockStmt = {
        kind: 'Block',
        stmts: stmt.thenBlock.stmts.flatMap(unrollStmt),
        loc: stmt.thenBlock.loc,
      };
      const newElse: BlockStmt | undefined = stmt.elseBlock
        ? {
            kind: 'Block',
            stmts: stmt.elseBlock.stmts.flatMap(unrollStmt),
            loc: stmt.elseBlock.loc,
          }
        : undefined;
      return [{ ...stmt, thenBlock: newThen, elseBlock: newElse }];
    }
    if (stmt.kind === 'Block') {
      return [{ ...stmt, stmts: stmt.stmts.flatMap(unrollStmt) }];
    }
    return [stmt];
  }

  function unrollWhile(wStmt: WhileStmt, count: number): Stmt[] {
    const unrolledBodyStmts = wStmt.body.stmts.flatMap(unrollStmt);

    // Recursively construct k-level peeled guards
    let currentInnerStmts: Stmt[] = [
      {
        kind: 'While',
        cond: wStmt.cond,
        body: { kind: 'Block', stmts: unrolledBodyStmts, loc: wStmt.body.loc },
        loc: wStmt.loc,
      },
    ];

    for (let i = 0; i < count; i++) {
      const peeledIf: IfStmt = {
        kind: 'If',
        cond: wStmt.cond,
        thenBlock: {
          kind: 'Block',
          stmts: [...unrolledBodyStmts, ...currentInnerStmts],
          loc: wStmt.body.loc,
        },
        loc: wStmt.loc,
      };
      currentInnerStmts = [peeledIf];
    }

    return currentInnerStmts;
  }

  return {
    stmts: program.stmts.flatMap(unrollStmt),
  };
}

/**
 * Transforms a CFG by peeling k iterations of loops.
 */
export function unrollCFG(ast: Program, k: number): CFG {
  if (k <= 0) {
    return buildCFG(ast);
  }
  const unrolledAST = unrollProgram(ast, k);
  return buildCFG(unrolledAST);
}
