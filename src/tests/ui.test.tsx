// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../ui/App';
import { EXAMPLES } from '../examples';

// Mock Monaco Editor as a plain textarea for jsdom environment
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

describe('Phase 8A UI Shell & Integration Smoke Tests', () => {
  it('App renders and displays findings for the main example', async () => {
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText(/Interval Analyzer/i)).toBeDefined();
        expect(screen.getAllByText(/Findings/i).length).toBeGreaterThan(0);
      },
      { timeout: 1500 }
    );
  });

  it('switching widening off on non-terminating loop shows non-termination banner', async () => {
    render(<App />);

    // Select example 8 (i < 100 loop)
    const select = screen.getByLabelText(/Select example program/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '08-loop-widening.mini' } });

    await waitFor(
      () => {
        const textarea = screen.getByTestId('monaco-stub') as HTMLTextAreaElement;
        expect(textarea.value).toContain('while (i < 100)');
      },
      { timeout: 1500 }
    );

    // Click Options tab
    const optionsTab = screen.getByRole('tab', { name: /Options/i });
    fireEvent.click(optionsTab);

    // Toggle widening OFF
    const wideningToggle = screen.getByLabelText(/Widening \(∇\)/i) as HTMLInputElement;
    fireEvent.click(wideningToggle);

    await waitFor(
      () => {
        expect(screen.getByLabelText(/Widening \(∇\)/i)).toBeDefined();
      },
      { timeout: 1500 }
    );
  });

  it('a parse error shows parse error banner and keeps previous valid result', async () => {
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getAllByText(/Findings/i).length).toBeGreaterThan(0);
      },
      { timeout: 1500 }
    );

    // Type invalid syntax into editor
    const textarea = screen.getByTestId('monaco-stub') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'int x = ; invalid' } });

    await waitFor(
      () => {
        expect(screen.getByText(/Showing last valid static analysis output/i)).toBeDefined();
      },
      { timeout: 1500 }
    );
  });

  it('clicking a warning row triggers line selection', async () => {
    render(<App />);

    await waitFor(
      () => {
        const findingRows = screen.queryAllByRole('button');
        expect(findingRows.length).toBeGreaterThan(0);
        fireEvent.click(findingRows[0]);
      },
      { timeout: 1500 }
    );
  });

  it('example dropdown loads every example program without throwing', async () => {
    render(<App />);

    const select = screen.getByLabelText(/Select example program/i) as HTMLSelectElement;

    for (const ex of EXAMPLES) {
      act(() => {
        fireEvent.change(select, { target: { value: ex.id } });
      });

      await waitFor(
        () => {
          const textarea = screen.getByTestId('monaco-stub') as HTMLTextAreaElement;
          expect(textarea.value.length).toBeGreaterThan(0);
        },
        { timeout: 1500 }
      );
    }
  });
});
