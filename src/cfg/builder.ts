import {
  Program,
  Stmt,
  VarDeclStmt,
  ArrayDeclStmt,
  AssignStmt,
  ArrayStoreStmt,
  IfStmt,
  WhileStmt,
  AssertStmt,
  BlockStmt,
} from '../core/ast';
import { CFG, Edge, NodeId, NodeInfo, Action } from './types';

export class CFGBuilder {
  private nextNodeId = 0;
  private nextEdgeId = 0;
  private nodes: NodeInfo[] = [];
  private edges: Edge[] = [];
  private loopHeads: NodeId[] = [];

  private createNode(isLoopHead = false, line?: number): NodeId {
    const id = this.nextNodeId++;
    this.nodes.push({ id, isLoopHead, line });
    if (isLoopHead) {
      this.loopHeads.push(id);
    }
    return id;
  }

  private addEdge(from: NodeId, to: NodeId, action: Action, line: number): Edge {
    const edge: Edge = {
      id: this.nextEdgeId++,
      from,
      to,
      action,
      line,
    };
    this.edges.push(edge);
    return edge;
  }

  public build(program: Program): CFG {
    const entry = this.createNode(false, program.stmts[0]?.loc.line ?? 1);
    let current = entry;

    if (program.stmts.length === 0) {
      const exit = this.createNode(false, 1);
      this.addEdge(entry, exit, { kind: 'skip' }, 1);
      return this.finalizeCFG(entry, exit);
    }

    for (const stmt of program.stmts) {
      current = this.buildStmt(stmt, current);
    }

    const exit = current;
    return this.finalizeCFG(entry, exit);
  }

  private buildStmt(stmt: Stmt, current: NodeId): NodeId {
    switch (stmt.kind) {
      case 'VarDecl':
        return this.buildVarDecl(stmt, current);
      case 'ArrayDecl':
        return this.buildArrayDecl(stmt, current);
      case 'Assign':
        return this.buildAssign(stmt, current);
      case 'ArrayStore':
        return this.buildArrayStore(stmt, current);
      case 'Assert':
        return this.buildAssert(stmt, current);
      case 'If':
        return this.buildIf(stmt, current);
      case 'While':
        return this.buildWhile(stmt, current);
      case 'Block':
        return this.buildBlock(stmt, current);
    }
  }

  private buildVarDecl(stmt: VarDeclStmt, current: NodeId): NodeId {
    const next = this.createNode(false, stmt.loc.line);
    this.addEdge(
      current,
      next,
      { kind: 'decl', name: stmt.name, init: stmt.init },
      stmt.loc.line
    );
    return next;
  }

  private buildArrayDecl(stmt: ArrayDeclStmt, current: NodeId): NodeId {
    const next = this.createNode(false, stmt.loc.line);
    this.addEdge(
      current,
      next,
      { kind: 'arrayDecl', name: stmt.name, size: stmt.size },
      stmt.loc.line
    );
    return next;
  }

  private buildAssign(stmt: AssignStmt, current: NodeId): NodeId {
    const next = this.createNode(false, stmt.loc.line);
    this.addEdge(
      current,
      next,
      { kind: 'assign', name: stmt.name, expr: stmt.value },
      stmt.loc.line
    );
    return next;
  }

  private buildArrayStore(stmt: ArrayStoreStmt, current: NodeId): NodeId {
    const next = this.createNode(false, stmt.loc.line);
    this.addEdge(
      current,
      next,
      { kind: 'store', array: stmt.name, index: stmt.index, expr: stmt.value },
      stmt.loc.line
    );
    return next;
  }

  private buildAssert(stmt: AssertStmt, current: NodeId): NodeId {
    const next = this.createNode(false, stmt.loc.line);
    this.addEdge(
      current,
      next,
      { kind: 'assert', cond: stmt.cond },
      stmt.loc.line
    );
    return next;
  }

  private buildIf(stmt: IfStmt, current: NodeId): NodeId {
    const join = this.createNode(false, stmt.loc.line);

    // Then branch: current --assume(cond, false)--> thenEntry ... thenExit --skip--> join
    const thenEntry = this.createNode(false, stmt.thenBlock.loc.line);
    this.addEdge(
      current,
      thenEntry,
      { kind: 'assume', cond: stmt.cond, negated: false },
      stmt.loc.line
    );
    const thenExit = this.buildBlock(stmt.thenBlock, thenEntry);
    this.addEdge(thenExit, join, { kind: 'skip' }, stmt.loc.line);

    // Else branch (or straight to join if no else)
    if (stmt.elseBlock) {
      const elseEntry = this.createNode(false, stmt.elseBlock.loc.line);
      this.addEdge(
        current,
        elseEntry,
        { kind: 'assume', cond: stmt.cond, negated: true },
        stmt.loc.line
      );
      const elseExit = this.buildBlock(stmt.elseBlock, elseEntry);
      this.addEdge(elseExit, join, { kind: 'skip' }, stmt.loc.line);
    } else {
      // False branch straight to join
      this.addEdge(
        current,
        join,
        { kind: 'assume', cond: stmt.cond, negated: true },
        stmt.loc.line
      );
    }

    return join;
  }

  private buildWhile(stmt: WhileStmt, current: NodeId): NodeId {
    const head = this.createNode(true, stmt.loc.line);
    // pre-loop -> head (skip)
    this.addEdge(current, head, { kind: 'skip' }, stmt.loc.line);

    // head -> body via assume(cond, false)
    const bodyEntry = this.createNode(false, stmt.body.loc.line);
    this.addEdge(
      head,
      bodyEntry,
      { kind: 'assume', cond: stmt.cond, negated: false },
      stmt.loc.line
    );

    // build body
    const bodyExit = this.buildBlock(stmt.body, bodyEntry);

    // body end -> head (skip, this is the back edge)
    this.addEdge(bodyExit, head, { kind: 'skip' }, stmt.loc.line);

    // head -> after-loop via assume(cond, true)
    const afterLoop = this.createNode(false, stmt.loc.line);
    this.addEdge(
      head,
      afterLoop,
      { kind: 'assume', cond: stmt.cond, negated: true },
      stmt.loc.line
    );

    return afterLoop;
  }

  private buildBlock(block: BlockStmt, current: NodeId): NodeId {
    if (block.stmts.length === 0) {
      const next = this.createNode(false, block.loc.line);
      this.addEdge(current, next, { kind: 'skip' }, block.loc.line);
      return next;
    }

    let node = current;
    for (const stmt of block.stmts) {
      node = this.buildStmt(stmt, node);
    }
    return node;
  }

  private finalizeCFG(entry: NodeId, exit: NodeId): CFG {
    const succ = new Map<NodeId, Edge[]>();
    const pred = new Map<NodeId, Edge[]>();

    for (const node of this.nodes) {
      succ.set(node.id, []);
      pred.set(node.id, []);
    }

    for (const edge of this.edges) {
      succ.get(edge.from)?.push(edge);
      pred.get(edge.to)?.push(edge);
    }

    return {
      entry,
      exit,
      nodes: this.nodes,
      edges: this.edges,
      succ,
      pred,
      loopHeads: this.loopHeads,
    };
  }
}

export function buildCFG(program: Program): CFG {
  return new CFGBuilder().build(program);
}
