import { Expr, Cond } from '../core/ast';

export type NodeId = number;

export type Action =
  | { kind: 'skip' }
  | { kind: 'decl'; name: string; init?: Expr }
  | { kind: 'arrayDecl'; name: string; size: number }
  | { kind: 'assign'; name: string; expr: Expr }
  | { kind: 'store'; array: string; index: Expr; expr: Expr }
  | { kind: 'assume'; cond: Cond; negated: boolean }
  | { kind: 'assert'; cond: Cond };

export interface Edge {
  id: number;
  from: NodeId;
  to: NodeId;
  action: Action;
  line: number;
}

export interface NodeInfo {
  id: NodeId;
  line?: number;
  isLoopHead: boolean;
}

export interface CFG {
  entry: NodeId;
  exit: NodeId;
  nodes: NodeInfo[];
  edges: Edge[];
  succ: Map<NodeId, Edge[]>;
  pred: Map<NodeId, Edge[]>;
  loopHeads: NodeId[];
}
