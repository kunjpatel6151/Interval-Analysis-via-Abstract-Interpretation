import React, { useEffect, useRef } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import { AnalysisResult } from '../analysis/analyze';
import { lineAnnotations, LineAnnotation } from '../analysis/annotate';
import { Finding } from '../analysis/checker';

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  result: AnalysisResult | null;
  activeResult: AnalysisResult | null;
  isParseError: boolean;
  theme: 'vs-dark' | 'light';
  targetLine?: number | null;
}

type MonacoInstance = Parameters<OnMount>[1];

function setupMiniLanguage(monaco: MonacoInstance) {
  if (monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === 'mini')) {
    return;
  }

  monaco.languages.register({ id: 'mini' });

  monaco.languages.setMonarchTokensProvider('mini', {
    keywords: ['int', 'if', 'else', 'while', 'assert', 'input'],
    operators: ['=', '+', '-', '*', '/', '<', '<=', '>', '>=', '==', '!=', '!', '&&', '||'],
    tokenizer: {
      root: [
        [/\/\/.*/, 'comment'],
        [
          /[a-zA-Z_][a-zA-Z0-9_]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
        [/[0-9]+/, 'number'],
        [/[{}()\[\]]/, 'delimiter'],
        [/[=+\-*\/<>!&|]+/, 'operator'],
        [/\s+/, 'white'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('mini', {
    comments: {
      lineComment: '//',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')', },
    ],
  });
}

export const Editor: React.FC<EditorProps> = ({
  value,
  onChange,
  result,
  activeResult,
  isParseError,
  theme,
  targetLine,
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);
  const hoverDisposableRef = useRef<any>(null);

  const annotationsRef = useRef<Map<number, LineAnnotation>>(new Map());
  const findingsRef = useRef<Finding[]>([]);

  // Update refs when activeResult changes
  useEffect(() => {
    if (activeResult) {
      annotationsRef.current = lineAnnotations(activeResult);
      findingsRef.current = activeResult.check?.findings || [];
    }
  }, [activeResult]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    setupMiniLanguage(monaco);

    // Register hover provider for mini language
    if (hoverDisposableRef.current) {
      hoverDisposableRef.current.dispose();
    }

    hoverDisposableRef.current = monaco.languages.registerHoverProvider('mini', {
      provideHover(_model: any, position: { lineNumber: number }) {
        const line = position.lineNumber;
        const ann = annotationsRef.current.get(line);
        const findings = findingsRef.current.filter((f) => f.line === line);

        if (!ann && findings.length === 0) {
          return null;
        }

        const contents: any[] = [];

        if (findings.length > 0) {
          contents.push({ value: `**Findings on Line ${line}:**` });
          for (const f of findings) {
            const label =
              f.kind === 'assertion'
                ? f.severity === 'safe'
                  ? 'PROVEN'
                  : f.severity === 'possible'
                  ? 'UNPROVEN'
                  : 'FAILS'
                : f.severity.toUpperCase();
            contents.push({ value: `- **${label}** \`${f.kind}\`: ${f.message}` });
          }
        }

        if (ann && ann.vars.length > 0) {
          contents.push({ value: '**Abstract Variables:**' });
          const varLines = ann.vars.map(
            (v) => `- \`${v.name}\`: \`${v.interval}\`${v.changed ? ' *(modified)*' : ''}`
          );
          contents.push({ value: varLines.join('\n') });
        }

        return {
          contents,
        };
      },
    });
  };

  // Reveal target line when requested (from WarningsPanel click)
  useEffect(() => {
    if (targetLine && editorRef.current) {
      editorRef.current.revealLineInCenter(targetLine);
      editorRef.current.setPosition({ lineNumber: targetLine, column: 1 });
      editorRef.current.focus();
    }
  }, [targetLine]);

  // Apply decorations (line colors & inline text) and parse error markers
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    // 1. Handle Parse Errors (Squiggles & Markers)
    if (isParseError && result?.errors && result.errors.length > 0) {
      const errMsg = result.errors[0];
      const match = errMsg.match(/line (\d+)(?:, col (\d+))?/i);
      const errLine = match ? parseInt(match[1], 10) : 1;
      const errCol = match && match[2] ? parseInt(match[2], 10) : 1;

      monaco.editor.setModelMarkers(model, 'mini-parser', [
        {
          startLineNumber: errLine,
          startColumn: errCol,
          endLineNumber: errLine,
          endColumn: errCol + 10,
          message: errMsg,
          severity: monaco.MarkerSeverity.Error,
        },
      ]);
    } else {
      monaco.editor.setModelMarkers(model, 'mini-parser', []);
    }

    // 2. Apply Line Decorations & Inline Annotations
    const targetResult = activeResult;
    if (!targetResult) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      return;
    }

    const annotations = lineAnnotations(targetResult);
    const newDecorations: any[] = [];

    for (const [line, ann] of annotations.entries()) {
      if (line > model.getLineCount()) continue;
      const lineContent = model.getLineContent(line);
      const maxCol = lineContent.length + 1;

      let className = '';
      if (!ann.reachable) {
        className = 'line-unreachable';
      } else if (ann.severity !== 'none') {
        className = `line-severity-${ann.severity}`;
      }

      const varStrs = ann.vars.map((v) => `${v.name}∈${v.interval}`);
      const inlineText = varStrs.length > 0 ? `  // ${varStrs.join(' ')}` : '';

      newDecorations.push({
        range: new monaco.Range(line, 1, line, maxCol),
        options: {
          isWholeLine: true,
          className: isParseError ? `${className} dimmed` : className,
          after: inlineText
            ? {
                content: inlineText,
                inlineClassName: isParseError ? 'monaco-inline-ann dimmed' : 'monaco-inline-ann',
              }
            : undefined,
        },
      });
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [result, activeResult, isParseError]);

  return (
    <div className="editor-wrapper">
      {isParseError && (
        <div className="banner banner-warning parse-error-banner">
          ⚠️ <strong>Parse Error:</strong> Showing last valid static analysis output.
        </div>
      )}
      <MonacoEditor
        height="100%"
        language="mini"
        theme={theme}
        value={value}
        onChange={(val) => onChange(val ?? '')}
        onMount={handleEditorMount}
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbersMinChars: 3,
          renderLineHighlight: 'all',
          glyphMargin: false,
          folding: false,
        }}
      />
    </div>
  );
};
