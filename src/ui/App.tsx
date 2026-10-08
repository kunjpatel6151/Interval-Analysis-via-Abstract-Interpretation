import React, { useState, useEffect } from 'react';
import { AnalysisOptions } from '../analysis/analyze';
import { useAnalysis } from './useAnalysis';
import { useSelection } from './useSelection';
import { EXAMPLES, Example } from '../examples';
import { Editor } from './Editor';
import { OptionsPanel } from './OptionsPanel';
import { WarningsPanel } from './WarningsPanel';
import { ExampleSelect } from './ExampleSelect';
import { CfgView } from './CfgView';
import { WorklistTable } from './WorklistTable';
import { NumberLine } from './NumberLine';
import { PlayControls } from './PlayControls';
import { NodeId } from '../cfg/types';
import './theme.css';

const LOCAL_STORAGE_SOURCE_KEY = 'interval_analyzer_source';
const LOCAL_STORAGE_OPTIONS_KEY = 'interval_analyzer_options';
const LOCAL_STORAGE_THEME_KEY = 'interval_analyzer_theme';

type TabKey = 'warnings' | 'options' | 'cfg' | 'worklist' | 'numberline';

const DEFAULT_OPTIONS: AnalysisOptions = {
  widening: true,
  narrowing: true,
  thresholds: false,
  wideningDelay: 2,
  narrowingRounds: 3,
  unrollLoops: 0,
  maxIterations: 10000,
  recordTrace: true,
  reportSafe: true,
};

function getInitialSource(): string {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_SOURCE_KEY);
    if (saved && saved.trim()) return saved;
  } catch {
    // Silent fallback
  }
  return EXAMPLES[0]?.source ?? 'int x = 1;';
}

function getInitialOptions(): AnalysisOptions {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_OPTIONS_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Silent fallback
  }
  return DEFAULT_OPTIONS;
}

function getInitialTheme(): 'vs-dark' | 'light' {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_THEME_KEY);
    if (saved === 'vs-dark' || saved === 'light') return saved;
  } catch {
    // Silent fallback
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'vs-dark';
  }
  return 'light';
}

export const App: React.FC = () => {
  const [source, setSource] = useState<string>(getInitialSource);
  const [options, setOptions] = useState<AnalysisOptions>(getInitialOptions);
  const [theme, setTheme] = useState<'vs-dark' | 'light'>(getInitialTheme);
  const [selectedExampleId, setSelectedExampleId] = useState<string>(EXAMPLES[0]?.id ?? '');
  const [targetLine, setTargetLine] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('warnings');

  // Analysis hook (300ms debounced)
  const { result, activeResult, isParseError } = useAnalysis(source, options);

  // Shared Selection & Playback State Hook
  const {
    step,
    setStep,
    selectedNode,
    setSelectedNode,
    selectedVar,
    setSelectedVar,
    playing,
    togglePlay,
    speedMs,
    setSpeedMs,
    dashboardMode,
    setDashboardMode,
  } = useSelection(activeResult);

  // Sync dataset theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'vs-dark' ? 'dark' : 'light');
    try {
      localStorage.setItem(LOCAL_STORAGE_THEME_KEY, theme);
    } catch {
      // Silent
    }
  }, [theme]);

  // Persist source & options
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_SOURCE_KEY, source);
    } catch {
      // Silent
    }
  }, [source]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // Silent
    }
  }, [options]);

  const handleSelectExample = (ex: Example) => {
    setSelectedExampleId(ex.id);
    setSource(ex.source);
  };

  const handleResetExample = () => {
    const ex = EXAMPLES.find((item) => item.id === selectedExampleId) || EXAMPLES[0];
    if (ex) {
      setSource(ex.source);
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'vs-dark' ? 'light' : 'vs-dark'));
  };

  const handleSelectNode = (nodeId: NodeId, line?: number) => {
    setSelectedNode(nodeId);
    if (line && line > 0) {
      setTargetLine(line);
    }
  };

  const isWideningOffAndUnterminated =
    options.widening === false && activeResult?.solve?.terminated === false;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <span>🔍</span> Interval Analyzer
        </div>

        <div className="header-controls">
          <ExampleSelect
            selectedId={selectedExampleId}
            onSelect={handleSelectExample}
            onReset={handleResetExample}
          />

          <button
            type="button"
            className={`btn ${dashboardMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setDashboardMode(!dashboardMode)}
            title="Toggle Dashboard side-by-side mode"
          >
            {dashboardMode ? '📑 Tabbed View' : '📊 Dashboard View'}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title="Toggle Light/Dark Theme"
          >
            {theme === 'vs-dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      {dashboardMode ? (
        /* Dashboard Mode Layout */
        <div className="dashboard-layout">
          <div className="dashboard-top-row">
            <section className="dashboard-col editor-column" aria-label="Code Editor">
              <Editor
                value={source}
                onChange={setSource}
                result={result}
                activeResult={activeResult}
                isParseError={isParseError}
                theme={theme}
                targetLine={targetLine}
              />
            </section>

            <section className="dashboard-col" aria-label="Control Flow Graph">
              <CfgView
                cfg={activeResult?.cfg ?? null}
                solveResult={activeResult?.solve ?? null}
                checkResult={activeResult?.check ?? null}
                step={step}
                selectedNode={selectedNode}
                onSelectNode={handleSelectNode}
              />
            </section>
          </div>

          <div className="dashboard-bottom-row">
            <section className="dashboard-col" aria-label="Number Line Visualizer">
              <NumberLine
                solveResult={activeResult?.solve ?? null}
                cfg={activeResult?.cfg ?? null}
                step={step}
                selectedNode={selectedNode}
                selectedVar={selectedVar}
                onSelectNode={handleSelectNode}
                onSelectVar={setSelectedVar}
                onSetStep={setStep}
              />
            </section>

            <section className="dashboard-col play-controls-docked" aria-label="Trace Docked Playback Controls">
              <PlayControls
                solveResult={activeResult?.solve ?? null}
                step={step}
                onSetStep={setStep}
                playing={playing}
                onTogglePlay={togglePlay}
                speedMs={speedMs}
                onSetSpeed={setSpeedMs}
              />
            </section>
          </div>
        </div>
      ) : (
        /* Tabbed Standard Two-Column Layout */
        <main className="main-content">
          {/* Left Column: Monaco Editor */}
          <section className="editor-column" aria-label="Code Editor">
            <Editor
              value={source}
              onChange={setSource}
              result={result}
              activeResult={activeResult}
              isParseError={isParseError}
              theme={theme}
              targetLine={targetLine}
            />
          </section>

          {/* Right Column: Tabbed Views */}
          <aside className="side-column" aria-label="Analysis Tabs and Panels">
            {/* Tab Bar */}
            <div className="tab-bar" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'warnings'}
                className={`tab-button ${activeTab === 'warnings' ? 'active' : ''}`}
                onClick={() => setActiveTab('warnings')}
              >
                ⚠️ Findings
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'options'}
                className={`tab-button ${activeTab === 'options' ? 'active' : ''}`}
                onClick={() => setActiveTab('options')}
              >
                ⚙️ Options
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'cfg'}
                className={`tab-button ${activeTab === 'cfg' ? 'active' : ''}`}
                onClick={() => setActiveTab('cfg')}
              >
                🕸️ CFG
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'worklist'}
                className={`tab-button ${activeTab === 'worklist' ? 'active' : ''}`}
                onClick={() => setActiveTab('worklist')}
              >
                📋 Worklist
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'numberline'}
                className={`tab-button ${activeTab === 'numberline' ? 'active' : ''}`}
                onClick={() => setActiveTab('numberline')}
              >
                📏 Number Line
              </button>
            </div>

            {/* Tab Contents */}
            <div className="tab-content">
              {activeTab === 'warnings' && (
                <WarningsPanel
                  checkResult={activeResult?.check ?? null}
                  isParseError={isParseError}
                  onSelectLine={(line) => setTargetLine(line)}
                />
              )}

              {activeTab === 'options' && (
                <OptionsPanel
                  options={options}
                  onChange={setOptions}
                  result={activeResult}
                />
              )}

              {activeTab === 'cfg' && (
                <CfgView
                  cfg={activeResult?.cfg ?? null}
                  solveResult={activeResult?.solve ?? null}
                  checkResult={activeResult?.check ?? null}
                  step={step}
                  selectedNode={selectedNode}
                  onSelectNode={handleSelectNode}
                />
              )}

              {activeTab === 'worklist' && (
                <WorklistTable
                  solveResult={activeResult?.solve ?? null}
                  cfg={activeResult?.cfg ?? null}
                  step={step}
                  onSetStep={setStep}
                  playing={playing}
                  onTogglePlay={togglePlay}
                  speedMs={speedMs}
                  onSetSpeed={setSpeedMs}
                  onSelectNode={handleSelectNode}
                  isWideningOffAndUnterminated={isWideningOffAndUnterminated}
                />
              )}

              {activeTab === 'numberline' && (
                <NumberLine
                  solveResult={activeResult?.solve ?? null}
                  cfg={activeResult?.cfg ?? null}
                  step={step}
                  selectedNode={selectedNode}
                  selectedVar={selectedVar}
                  onSelectNode={handleSelectNode}
                  onSelectVar={setSelectedVar}
                  onSetStep={setStep}
                />
              )}
            </div>
          </aside>
        </main>
      )}
    </div>
  );
};

export default App;
