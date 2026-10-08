// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { analyze } from '../analysis/analyze';
import { CfgView } from '../ui/CfgView';
import { WorklistTable } from '../ui/WorklistTable';
import { NumberLine } from '../ui/NumberLine';

// Mock Monaco Editor for jsdom environment
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <textarea
      data-testid="monaco-stub"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

describe('Phase 8B Views & Interaction Tests', () => {
  const codeLoop = `int i = 0;
while (i < 100) {
  i = i + 1;
}`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. CFG view renders one node element per CFG node and paths for edges', () => {
    const res = analyze(codeLoop);
    const { container } = render(
      <CfgView
        cfg={res.cfg!}
        solveResult={res.solve!}
        checkResult={res.check!}
        step={0}
        selectedNode={null}
        onSelectNode={vi.fn()}
      />
    );

    const nodeGroups = container.querySelectorAll('.cfg-node-group');
    expect(nodeGroups.length).toBe(res.cfg!.nodes.length);

    const edgePaths = container.querySelectorAll('.cfg-edge-path');
    expect(edgePaths.length).toBe(res.cfg!.edges.length);
  });

  it('2. back edge of (i < 100) loop has dashed back-edge class', () => {
    const res = analyze(codeLoop);
    const { container } = render(
      <CfgView
        cfg={res.cfg!}
        solveResult={res.solve!}
        checkResult={res.check!}
        step={0}
        selectedNode={null}
        onSelectNode={vi.fn()}
      />
    );

    const backEdgePath = container.querySelector('.back-edge');
    expect(backEdgePath).not.toBeNull();
  });

  it('3. clicking a CFG node selects it and invokes onSelectNode callback with source line', () => {
    const res = analyze(codeLoop);
    const onSelectNodeMock = vi.fn();

    const { container } = render(
      <CfgView
        cfg={res.cfg!}
        solveResult={res.solve!}
        checkResult={res.check!}
        step={0}
        selectedNode={null}
        onSelectNode={onSelectNodeMock}
      />
    );

    const firstNode = container.querySelector('.cfg-node-group') as SVGElement;
    expect(firstNode).not.toBeNull();
    fireEvent.click(firstNode);

    expect(onSelectNodeMock).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  it('4. NumberLine renders history bars and infinite bound markers', () => {
    const res = analyze(codeLoop);
    const { container } = render(
      <NumberLine
        solveResult={res.solve!}
        cfg={res.cfg!}
        step={0}
        selectedNode={res.cfg!.loopHeads[0]}
        selectedVar="i"
        onSelectNode={vi.fn()}
        onSelectVar={vi.fn()}
        onSetStep={vi.fn()}
      />
    );

    const bars = container.querySelectorAll('.nl-bar-group');
    expect(bars.length).toBeGreaterThan(0);

    const marker = container.querySelector('#arrow-inf-right');
    expect(marker).not.toBeNull();
  });

  it('5. play button invokes onTogglePlay callback', () => {
    const res = analyze(codeLoop);
    const onTogglePlayMock = vi.fn();

    render(
      <WorklistTable
        solveResult={res.solve!}
        cfg={res.cfg!}
        step={0}
        onSetStep={vi.fn()}
        playing={false}
        onTogglePlay={onTogglePlayMock}
        speedMs={100}
        onSetSpeed={vi.fn()}
        onSelectNode={vi.fn()}
      />
    );

    const playBtn = screen.getByRole('button', { name: 'Play' });
    fireEvent.click(playBtn);

    expect(onTogglePlayMock).toHaveBeenCalled();
  });

  it('6. widening OFF on loop displays non-termination cap warning and no narrowing phase', () => {
    const res = analyze(codeLoop, { widening: false, maxIterations: 10 });
    const { container } = render(
      <WorklistTable
        solveResult={res.solve!}
        cfg={res.cfg!}
        step={0}
        onSetStep={vi.fn()}
        playing={false}
        onTogglePlay={vi.fn()}
        speedMs={400}
        onSetSpeed={vi.fn()}
        onSelectNode={vi.fn()}
        isWideningOffAndUnterminated={true}
      />
    );

    expect(screen.getByText(/Iteration Cap Reached/i)).toBeDefined();
    const narrowingChip = container.querySelector('.phase-narrowing');
    expect(narrowingChip).toBeNull();
  });
});
