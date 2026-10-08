export interface Example {
  id: string;
  name: string;
  description: string;
  source: string;
}

const DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  '01-division.mini': {
    name: '1. Guarded Division',
    description: 'Shows POSSIBLE div-by-zero on un-guarded division and SAFE inside if-guard.',
  },
  '02-definite-zero.mini': {
    name: '2. Definite Division by Zero',
    description: 'Division by literal 0 creates DEFINITE warning and makes downstream lines unreachable.',
  },
  '03-array-bounds.mini': {
    name: '3. Array Bounds Loop',
    description: 'Array store verified SAFE via loop guard refinement [0, 9].',
  },
  '04-overflow.mini': {
    name: '4. Integer Overflow',
    description: 'Demonstrates POSSIBLE vs SAFE 32-bit signed integer overflow.',
  },
  '05-assertions.mini': {
    name: '5. Assertions',
    description: 'PROVEN (safe), UNPROVEN (possible), and FAILS (definite) assertion states.',
  },
  '06-dead-code.mini': {
    name: '6. Dead Branch',
    description: 'Detects unreachable code path when branch condition is never satisfied.',
  },
  '07-imprecision.mini': {
    name: '7. Relational Imprecision (x - x)',
    description: 'Expected false positive caused by non-relational interval abstraction.',
  },
  '08-loop-widening.mini': {
    name: '8. Loop Widening (i < 100)',
    description: 'Demonstrates loop fixpoint termination with widening vs non-termination without it.',
  },
};

// Raw imports via Vite glob
const rawFiles = import.meta.glob('./*.mini', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const EXAMPLES: Example[] = Object.entries(rawFiles)
  .map(([path, source]) => {
    const filename = path.replace('./', '');
    const info = DESCRIPTIONS[filename] || {
      name: filename,
      description: 'Example program',
    };
    return {
      id: filename,
      name: info.name,
      description: info.description,
      source: source.trim(),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
