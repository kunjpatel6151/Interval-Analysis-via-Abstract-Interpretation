import { Lexer } from '../core/lexer';
import { Parser } from '../core/parser';
import { Program } from '../core/ast';
import { CFG } from '../cfg/types';
import { buildCFG } from '../cfg/builder';
import { unrollCFG } from '../cfg/unroll';
import { solve, SolveResult, SolveOptions } from './fixpoint';
import { Observer } from './eval';
import { transfer } from './transfer';
import { collectThresholds } from './widen';
import { checkProgram, CheckResult } from './checker';

export interface AnalysisOptions {
  widening?: boolean;          // default true
  narrowing?: boolean;         // default true
  thresholds?: boolean;        // default false
  wideningDelay?: number;      // default 2 (visits to a loop head before widening)
  narrowingRounds?: number;    // default 3
  unrollLoops?: number;        // default 0
  maxIterations?: number;      // default 10000
  recordTrace?: boolean;       // default true
  reportSafe?: boolean;        // default true
}

export interface AnalysisResult {
  ast?: Program;
  cfg?: CFG;
  solve?: SolveResult;
  check?: CheckResult;
  errors: string[];
}

/**
 * End-to-end static analyzer entry point:
 * Wires source code -> lexer -> parser -> CFG construction -> worklist fixpoint -> checker.
 * Catches syntax and parse errors gracefully, returning them in `errors` so that
 * UI components and tools can display diagnostics without crashing.
 */
export function analyze(
  source: string,
  options: Partial<AnalysisOptions> = {},
  obs?: Observer
): AnalysisResult {
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    // Harvest thresholds from program text if threshold widening is requested
    const thresholdsList = options.thresholds ? collectThresholds(ast) : undefined;

    // Apply loop unrolling if configured
    const unrollCount = options.unrollLoops ?? 0;
    const cfg = unrollCount > 0 ? unrollCFG(ast, unrollCount) : buildCFG(ast);

    const solveOpts: SolveOptions = {
      widening: options.widening ?? true,
      narrowing: options.narrowing ?? true,
      thresholds: options.thresholds ?? false,
      thresholdsList,
      wideningDelay: options.wideningDelay ?? 2,
      narrowingRounds: options.narrowingRounds ?? 3,
      unrollLoops: unrollCount,
      maxIterations: options.maxIterations ?? 10000,
      recordTrace: options.recordTrace ?? true,
    };

    const solveRes = solve(cfg, solveOpts, obs);
    const checkRes = checkProgram(cfg, solveRes.states, {
      reportSafe: options.reportSafe ?? true,
    });

    return {
      ast,
      cfg,
      solve: solveRes,
      check: checkRes,
      errors: [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      errors: [message],
    };
  }
}

/**
 * Computes the sorted, de-duplicated source lines that are unreachable (dead code):
 * lines whose outgoing edges start from an UNREACHABLE node, or whose edge transfer
 * yields UNREACHABLE.
 */
export function unreachableLines(result: AnalysisResult): number[] {
  if (!result.cfg || !result.solve) {
    return [];
  }

  const lines = new Set<number>();

  for (const edge of result.cfg.edges) {
    const preState = result.solve.states.get(edge.from);
    if (!preState || preState.isUnreachable()) {
      if (edge.line > 0) lines.add(edge.line);
    } else {
      const postState = transfer(edge, preState);
      if (postState.isUnreachable()) {
        if (edge.line > 0) lines.add(edge.line);
      }
    }
  }

  return Array.from(lines).sort((a, b) => a - b);
}
