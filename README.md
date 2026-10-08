# Interval Analyzer

> A static program analyzer and interactive visualizer based on **Abstract Interpretation** over the Interval Abstract Domain ($\mathcal{I} = \mathbb{Z} \cup \{-\infty, +\infty\}$).

Built with **TypeScript, Vite, React, Monaco Editor, D3.js, Dagre, and Vitest**. The core static analysis engine is a pure TypeScript library with **zero UI imports or dependencies**.

---

## 🚀 Features & Architecture

### 1. Analysis Core (`src/core/`, `src/cfg/`, `src/domain/`, `src/analysis/`)
- **Hand-written Lexer & Parser (`src/core/`)**: Zero-dependency lexer and recursive-descent parser with line/column location tracking for mini imperative language (`int`, `if`, `else`, `while`, `assert`, `input(min, max)`, array reads/stores).
- **Control Flow Graph (`src/cfg/`)**: Edge-labeled CFG builder, reverse post-order (RPO) node ranking, loop head detection, back-edge identification, and loop unrolling transform.
- **Interval Abstract Domain (`src/domain/`)**: Complete interval lattice implementation ($\bot, \top$, range, join $\sqcup$, meet $\sqcap$, inclusion $\sqsubseteq$, interval arithmetic over idealized mathematical integers $\mathbb{Z}$).
- **Abstract Transfer & Refinement (`src/analysis/`)**:
  - `evalExpr`: Abstract expression evaluation.
  - `refine`: Backward branch guard refinement pushing negation inward via De Morgan's laws.
  - `solve`: Fixed-point iteration worklist solver with ascending phase, delayed widening ($\nabla$), threshold widening, and descending narrowing ($\Delta$).
- **Static Analysis Checker (`src/analysis/checker.ts`)**: Evaluates post-fixpoint pre-states to detect:
  - **Division by Zero** (`safe`, `possible`, `definite`)
  - **Array Out of Bounds** (reads & stores)
  - **32-Bit Signed Integer Overflow**
  - **Assertion Verification** (`PROVEN`, `UNPROVEN`, `FAILS` evaluated soundly on pre-state)
  - **Dead Code / Dead Branch Detection** (`unreachable`)

### 2. Interactive Web Visualizer (`src/ui/`)
- **Monaco Code Editor**: Custom `mini` language tokenizer, line severity background highlighting, inline end-of-line interval annotations (`// x∈[0, 10] y∈[1, 10]`), parse error markers, and rich hover cards.
- **D3 + Dagre CFG Graph (`src/ui/CfgView.tsx`)**: Interactive graph layout powered by Dagre and D3-Zoom, featuring rounded nodes, loop head double-borders, dashed back-edges, step state tags, and zoom/pan controls.
- **Worklist Iteration Table (`src/ui/WorklistTable.tsx`)**: Windowed trace table listing step-by-step state transitions, operator chips ($\nabla, \Delta$), phase chips, and step scrubbing slider.
- **Number Line Chart (`src/ui/NumberLine.tsx`)**: Stacked horizontal D3 number line showing interval evolution over time ($[0,0] \to [0,1] \xrightarrow{\nabla} [0, +\infty] \xrightarrow{\Delta} [0, 100]$) with infinite bound arrow markers and threshold lines.
- **Dashboard & Tabbed Views**: Flexible UI allowing single-tab mode or side-by-side Dashboard layout.

---

## 🛠️ Getting Started

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher

### Installation & Run

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Start Vite development server:
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173`.

3. Run full Vitest test suite (116 tests):
   ```bash
   npm test
   ```

4. Build production bundle:
   ```bash
   npm run build
   ```

---

## 🎮 Interactive Demo Guide

1. **Guarded Division (`1. Guarded Division`)**:
   - Line 3 (`z = 100 / y;`) shows **Yellow (Possible Div-by-Zero)** because $y \in [0, 10]$.
   - Line 5 (`z = 100 / y;` inside `if (y > 0)`) shows **Green (Safe)** because guard refines $y$ to $[1, 10]$.
2. **Loop Widening & Narrowing (`8. Loop Widening (i < 100)`)**:
   - With Widening ON: Solver terminates in 4 iterations ($[0, 0] \to [0, 1] \xrightarrow{\nabla} [0, +\infty] \xrightarrow{\Delta} [0, 100]$).
   - Toggle Widening OFF: Red non-termination banner appears, showing trace cutoff at iteration cap.
3. **Dead Branch (`6. Dead Branch`)**:
   - `if (x > 10)` when $x=5$ displays **Gray (Unreachable)** line styling and dead branch warning.

---

## 🧪 Testing & Soundness

All 116 tests pass across 12 test suites:
- **Unit Tests**: Lexer, Parser, Interpreter, Abstract Domain, Transfer, Refinement, Widening/Narrowing, Checker.
- **Soundness Property Testing**: 500+ randomized concrete interpreter runs verifying **zero false negatives** against static checker findings.
- **UI & Replay Tests**: React Testing Library and Vitest jsdom tests for trace replay, checkpoints, slider scrubbing, and component rendering.

---

## 📜 License
MIT
