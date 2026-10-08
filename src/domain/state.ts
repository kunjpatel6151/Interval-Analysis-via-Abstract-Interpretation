import {
  Interval,
  BOTTOM,
  TOP,
  isBottom,
  join as intervalJoin,
  meet as intervalMeet,
  leq as intervalLeq,
  equals as intervalEquals,
  widen as intervalWiden,
  widenWithThresholds as intervalWidenWithThresholds,
  narrow as intervalNarrow,
  intervalToString,
} from './interval';

/**
 * Representation of an Abstract State at a program point.
 * Either UNREACHABLE (⊥) indicating dead or unexecutable code,
 * or an environment mapping variable names to their abstract intervals
 * and array names to their declared sizes.
 */
export class AbstractState {
  private readonly unreachable: boolean;
  private readonly vars: Map<string, Interval>;
  private readonly arrays: Map<string, number>;

  private constructor(
    unreachable: boolean,
    vars?: Map<string, Interval>,
    arrays?: Map<string, number>
  ) {
    this.unreachable = unreachable;
    this.vars = vars ? new Map(vars) : new Map();
    this.arrays = arrays ? new Map(arrays) : new Map();

    // Invariant: if any variable interval is BOTTOM, the entire state is unreachable.
    if (!this.unreachable) {
      for (const val of this.vars.values()) {
        if (isBottom(val)) {
          this.unreachable = true;
          this.vars.clear();
          this.arrays.clear();
          break;
        }
      }
    }
  }

  // Canonical unreachable bottom state
  public static readonly UNREACHABLE = new AbstractState(true);

  // Canonical empty reachable state (top for all unassigned variables)
  public static empty(): AbstractState {
    return new AbstractState(false);
  }

  public static of(
    vars: Record<string, Interval>,
    arrays: Record<string, number> = {}
  ): AbstractState {
    const vMap = new Map<string, Interval>();
    for (const [k, v] of Object.entries(vars)) {
      if (isBottom(v)) {
        return AbstractState.UNREACHABLE;
      }
      vMap.set(k, v);
    }
    const aMap = new Map<string, number>(Object.entries(arrays));
    return new AbstractState(false, vMap, aMap);
  }

  public isUnreachable(): boolean {
    return this.unreachable;
  }

  public getVars(): Map<string, Interval> {
    return new Map(this.vars);
  }

  public getArrays(): Map<string, number> {
    return new Map(this.arrays);
  }

  /**
   * Soundness note on missing variables:
   * A variable not explicitly present in the state is treated as TOP ([-∞, +∞]).
   * This is the sound over-approximation in static analysis because an unconstrained
   * or unknown variable may take any integer value.
   */
  public get(name: string): Interval {
    if (this.unreachable) return BOTTOM;
    return this.vars.get(name) ?? TOP;
  }

  /**
   * Immutable update: returns a fresh AbstractState with the variable set.
   * If the updated interval is BOTTOM, normalizes the entire state to UNREACHABLE.
   */
  public set(name: string, interval: Interval): AbstractState {
    if (this.unreachable || isBottom(interval)) {
      return AbstractState.UNREACHABLE;
    }
    const newVars = new Map(this.vars);
    newVars.set(name, interval);
    return new AbstractState(false, newVars, this.arrays);
  }

  public getArraySize(name: string): number | undefined {
    if (this.unreachable) return undefined;
    return this.arrays.get(name);
  }

  public setArraySize(name: string, size: number): AbstractState {
    if (this.unreachable) return AbstractState.UNREACHABLE;
    const newArrays = new Map(this.arrays);
    newArrays.set(name, size);
    return new AbstractState(false, this.vars, newArrays);
  }

  /**
   * Pointwise join (⊔) over variable environments.
   * Join with UNREACHABLE is the identity: state ⊔ ⊥ = state.
   */
  public join(other: AbstractState): AbstractState {
    if (this.unreachable) return other;
    if (other.unreachable) return this;

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    const mergedVars = new Map<string, Interval>();

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      mergedVars.set(key, intervalJoin(v1, v2));
    }

    const mergedArrays = new Map([...this.arrays, ...other.arrays]);
    return new AbstractState(false, mergedVars, mergedArrays);
  }

  /**
   * Pointwise meet (⊓) over variable environments.
   * If any intersection yields BOTTOM, the entire state becomes UNREACHABLE.
   */
  public meet(other: AbstractState): AbstractState {
    if (this.unreachable || other.unreachable) {
      return AbstractState.UNREACHABLE;
    }

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    const mergedVars = new Map<string, Interval>();

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      const inter = intervalMeet(v1, v2);
      if (isBottom(inter)) {
        return AbstractState.UNREACHABLE;
      }
      mergedVars.set(key, inter);
    }

    const mergedArrays = new Map([...this.arrays, ...other.arrays]);
    return new AbstractState(false, mergedVars, mergedArrays);
  }

  /**
   * Partial order (⊑) pointwise across all variables.
   * UNREACHABLE is the least element.
   */
  public leq(other: AbstractState): boolean {
    if (this.unreachable) return true;
    if (other.unreachable) return false;

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      if (!intervalLeq(v1, v2)) {
        return false;
      }
    }
    return true;
  }

  public equals(other: AbstractState): boolean {
    if (this.unreachable && other.unreachable) return true;
    if (this.unreachable || other.unreachable) return false;

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      if (!intervalEquals(v1, v2)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Pointwise widening (∇).
   */
  public widen(other: AbstractState): AbstractState {
    if (this.unreachable) return other;
    if (other.unreachable) return this;

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    const resultVars = new Map<string, Interval>();

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      resultVars.set(key, intervalWiden(v1, v2));
    }

    const mergedArrays = new Map([...this.arrays, ...other.arrays]);
    return new AbstractState(false, resultVars, mergedArrays);
  }

  /**
   * Pointwise widening with thresholds.
   */
  public widenWithThresholds(other: AbstractState, thresholds: number[]): AbstractState {
    if (this.unreachable) return other;
    if (other.unreachable) return this;

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    const resultVars = new Map<string, Interval>();

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      resultVars.set(key, intervalWidenWithThresholds(v1, v2, thresholds));
    }

    const mergedArrays = new Map([...this.arrays, ...other.arrays]);
    return new AbstractState(false, resultVars, mergedArrays);
  }

  /**
   * Pointwise narrowing (Δ).
   */
  public narrow(other: AbstractState): AbstractState {
    if (this.unreachable) return this;
    if (other.unreachable) return other;

    const allKeys = new Set([...this.vars.keys(), ...other.vars.keys()]);
    const resultVars = new Map<string, Interval>();

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      resultVars.set(key, intervalNarrow(v1, v2));
    }

    const mergedArrays = new Map([...this.arrays, ...other.arrays]);
    return new AbstractState(false, resultVars, mergedArrays);
  }

  public toString(): string {
    if (this.unreachable) return '⊥';
    if (this.vars.size === 0) return '⊤';

    const entries = Array.from(this.vars.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}∈${intervalToString(v)}`);

    return entries.join(' ');
  }
}
