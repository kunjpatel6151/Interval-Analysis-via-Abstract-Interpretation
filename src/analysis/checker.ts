import { CFG, NodeId } from '../cfg/types';
import { AbstractState } from '../domain/state';
import { evalExpr, Observer } from './eval';
import { refine } from './refine';
import {
  intervalToString,
  isSingleton,
  contains,
  withinInt32,
  outsideInt32,
} from '../domain/interval';
import { prettyPrintExpr, prettyPrintCond } from '../cfg/printer';
import { Cond } from '../core/ast';

export type Severity = 'safe' | 'possible' | 'definite' | 'unreachable';

export type FindingKind =
  | 'div-by-zero'
  | 'array-bounds'
  | 'overflow'
  | 'assertion'
  | 'unreachable';

export interface Finding {
  id: number;
  line: number;
  kind: FindingKind;
  severity: Severity;            // for assertions: "safe" = proven, "possible" = unproven, "definite" = always fails
  message: string;               // human readable, e.g. "divisor y ∈ [0,10] may be zero"
  intervals: Record<string, string>;  // named intervals involved, as strings
  edgeId: number;
}

export interface CheckResult {
  findings: Finding[];
  summary: { safe: number; possible: number; definite: number; unreachable: number };
}

/**
 * Static Analysis Checker (Phase 7):
 * Runs AFTER the fixpoint computation over the Control Flow Graph.
 *
 * DESIGN PHILOSOPHY:
 * The checker takes the final fixpoint abstract states at each CFG node.
 * For every edge e = (u -> v), it takes the PRE-state (state at node u) and
 * re-evaluates the edge's expressions using an Observer hook.
 *
 * USING PRE-STATE IS ESSENTIAL:
 * For `assert(c)`, the condition must be checked against the pre-state BEFORE
 * refinement by `c`. Testing after refinement would trivially prove all assertions safe!
 *
 * DOWNSTREAM OVERFLOW SIMPLIFICATION:
 * Abstract transfer functions evaluate over idealized mathematical integers (ℤ ∪ {-∞, +∞}).
 * After an overflow finding ("possible" or "definite"), the analysis intentionally preserves
 * the un-wrapped mathematical interval. This is a documented simplification that avoids
 * non-convex interval splitting while maintaining overall soundness (no false negatives).
 */
export function checkProgram(
  cfg: CFG,
  states: Map<NodeId, AbstractState>,
  opts?: { reportSafe?: boolean }
): CheckResult {
  const reportSafe = opts?.reportSafe ?? true;

  const rawFindings: Finding[] = [];
  const seenKeys = new Set<string>();
  const unreachableLinesEmitted = new Set<number>();

  const summary = { safe: 0, possible: 0, definite: 0, unreachable: 0 };

  function addFinding(
    line: number,
    kind: FindingKind,
    severity: Severity,
    message: string,
    intervals: Record<string, string>,
    edgeId: number
  ) {
    if (line <= 0) return;

    // Rule 6: De-duplicate per (line, kind, message)
    const key = `${line}:${kind}:${message}`;
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    summary[severity]++;

    const finding: Finding = {
      id: rawFindings.length + 1,
      line,
      kind,
      severity,
      message,
      intervals,
      edgeId,
    };
    rawFindings.push(finding);
  }

  // Process edges in deterministic order by edge id
  const sortedEdges = [...cfg.edges].sort((a, b) => a.id - b.id);

  for (const edge of sortedEdges) {
    const preState = states.get(edge.from);

    // Rule 0: Source state UNREACHABLE
    if (!preState || preState.isUnreachable()) {
      if (edge.line > 0 && !unreachableLinesEmitted.has(edge.line)) {
        unreachableLinesEmitted.add(edge.line);
        addFinding(
          edge.line,
          'unreachable',
          'unreachable',
          'code is unreachable',
          {},
          edge.id
        );
      }
      continue;
    }

    // Reachable edge: evaluate expressions with Observer hooks
    const obs: Observer = {
      onDiv(line, divisor, _res, divisorExpr) {
        const exprStr = divisorExpr ? prettyPrintExpr(divisorExpr) : 'divisor';
        const invStr = intervalToString(divisor);
        let severity: Severity;
        let msg: string;

        if (!divisor.bottom && isSingleton(divisor) && divisor.lo === 0) {
          severity = 'definite';
          msg = `divisor ${exprStr} ∈ ${invStr} is zero`;
        } else if (contains(divisor, 0)) {
          severity = 'possible';
          msg = `divisor ${exprStr} ∈ ${invStr} may be zero`;
        } else {
          severity = 'safe';
          msg = `divisor ${exprStr} ∈ ${invStr} is non-zero`;
        }

        addFinding(
          line,
          'div-by-zero',
          severity,
          msg,
          { [exprStr]: invStr },
          edge.id
        );
      },

      onIndex(line, arrayName, index) {
        const size = preState.getArraySize(arrayName);
        const idxStr = intervalToString(index);

        if (size === undefined) {
          addFinding(
            line,
            'array-bounds',
            'possible',
            `array index ∈ ${idxStr} on unknown array ${arrayName}`,
            { index: idxStr },
            edge.id
          );
          return;
        }

        const validStr = `[0,${size - 1}]`;
        if (index.bottom) return;

        let severity: Severity;
        let msg: string;

        if (index.hi < 0 || index.lo >= size) {
          severity = 'definite';
          msg = `array index ∈ ${idxStr} is out of bounds ${validStr}`;
        } else if (index.lo >= 0 && index.hi <= size - 1) {
          severity = 'safe';
          msg = `array index ∈ ${idxStr} is within bounds ${validStr}`;
        } else {
          severity = 'possible';
          msg = `array index ∈ ${idxStr} may be out of bounds ${validStr}`;
        }

        addFinding(
          line,
          'array-bounds',
          severity,
          msg,
          { index: idxStr, bounds: validStr },
          edge.id
        );
      },

      onArith(line, _op, result, expr) {
        const resStr = intervalToString(result);
        const exprStr = expr ? prettyPrintExpr(expr) : 'operation result';
        let severity: Severity;
        let msg: string;

        if (outsideInt32(result)) {
          severity = 'definite';
          msg = `${exprStr} result ∈ ${resStr} overflows int32`;
        } else if (withinInt32(result)) {
          severity = 'safe';
          msg = `${exprStr} result ∈ ${resStr} is within int32 bounds`;
        } else {
          severity = 'possible';
          msg = `${exprStr} result ∈ ${resStr} may overflow int32`;
        }

        addFinding(
          line,
          'overflow',
          severity,
          msg,
          { result: resStr },
          edge.id
        );
      },
    };

    switch (edge.action.kind) {
      case 'decl':
        if (edge.action.init) {
          evalExpr(edge.action.init, preState, obs);
        }
        break;

      case 'assign':
        evalExpr(edge.action.expr, preState, obs);
        break;

      case 'store':
        evalExpr(edge.action.index, preState, obs);
        obs.onIndex?.(
          edge.line,
          edge.action.array,
          evalExpr(edge.action.index, preState)
        );
        evalExpr(edge.action.expr, preState, obs);
        break;

      case 'assume': {
        checkCondExprs(edge.action.cond, preState, obs, edge.line);

        // Rule 5: Dead branch check
        const postState = refine(edge.action.cond, preState, edge.action.negated);
        if (postState.isUnreachable()) {
          const condText = prettyPrintCond(edge.action.cond);
          const msg = edge.action.negated
            ? `branch condition [!(${condText})] is never true`
            : `branch condition [${condText}] is never true`;

          addFinding(
            edge.line,
            'unreachable',
            'unreachable',
            msg,
            {},
            edge.id
          );
        }
        break;
      }

      case 'assert': {
        checkCondExprs(edge.action.cond, preState, obs, edge.line);

        // Rule 4: Assertion evaluated on PRE-state
        const cond = edge.action.cond;
        const badState = refine(cond, preState, true);
        const goodState = refine(cond, preState, false);

        let severity: Severity;
        let msg: string;
        const condText = prettyPrintCond(cond);

        if (badState.isUnreachable()) {
          severity = 'safe';
          msg = `assertion assert(${condText}) holds`;
        } else if (goodState.isUnreachable()) {
          severity = 'definite';
          msg = `assertion assert(${condText}) always fails`;
        } else {
          severity = 'possible';
          msg = `assertion assert(${condText}) may fail`;
        }

        const intervals: Record<string, string> = {};
        for (const [varName, inv] of preState.getVars().entries()) {
          intervals[varName] = intervalToString(inv);
        }

        addFinding(
          edge.line,
          'assertion',
          severity,
          msg,
          intervals,
          edge.id
        );
        break;
      }
    }
  }

  const findings = reportSafe
    ? rawFindings
    : rawFindings.filter((f) => f.severity !== 'safe');

  return {
    findings,
    summary,
  };
}

function checkCondExprs(
  cond: Cond,
  state: AbstractState,
  obs: Observer,
  line: number
) {
  switch (cond.kind) {
    case 'CompareCond':
      evalExpr(cond.left, state, obs);
      evalExpr(cond.right, state, obs);
      break;
    case 'NotCond':
      checkCondExprs(cond.expr, state, obs, line);
      break;
    case 'LogicalCond':
      checkCondExprs(cond.left, state, obs, line);
      checkCondExprs(cond.right, state, obs, line);
      break;
  }
}

// ---------------------------------------------------------------------------
// Reporting Helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  definite: 4,
  possible: 3,
  unreachable: 2,
  safe: 1,
};

/**
 * Returns the worst severity on a line, ordered by definite > possible > unreachable > safe.
 */
export function lineSeverity(result: CheckResult, line: number): Severity {
  const lineFindings = result.findings.filter((f) => f.line === line);
  if (lineFindings.length === 0) {
    return 'safe';
  }

  let worst: Severity = 'safe';
  for (const f of lineFindings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) {
      worst = f.severity;
    }
  }
  return worst;
}

/**
 * Groups findings by line number into a Map.
 */
export function groupByLine(result: CheckResult): Map<number, Finding[]> {
  const map = new Map<number, Finding[]>();
  for (const f of result.findings) {
    const list = map.get(f.line) || [];
    list.push(f);
    map.set(f.line, list);
  }
  return map;
}

/**
 * Formats a single finding into a standard one-line string.
 * e.g., "line 3: POSSIBLE div-by-zero: divisor y ∈ [0, 10] may be zero"
 */
export function formatFinding(f: Finding): string {
  return `line ${f.line}: ${f.severity.toUpperCase()} ${f.kind}: ${f.message}`;
}

/**
 * Formats full CheckResult report sorted by line number with summary count at the end.
 */
export function formatReport(result: CheckResult): string {
  const sorted = [...result.findings].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.id - b.id;
  });

  const lines = sorted.map(formatFinding);
  const summaryLine = `Summary: ${result.summary.safe} safe, ${result.summary.possible} possible, ${result.summary.definite} definite, ${result.summary.unreachable} unreachable`;

  if (lines.length === 0) {
    return summaryLine;
  }

  return `${lines.join('\n')}\n\n${summaryLine}`;
}
