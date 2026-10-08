import { useState, useEffect, useRef } from 'react';
import { analyze, AnalysisResult, AnalysisOptions } from '../analysis/analyze';

export interface UseAnalysisReturn {
  result: AnalysisResult | null;
  lastValidResult: AnalysisResult | null;
  activeResult: AnalysisResult | null;
  isParseError: boolean;
}

export function useAnalysis(
  source: string,
  options: AnalysisOptions
): UseAnalysisReturn {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [lastValidResult, setLastValidResult] = useState<AnalysisResult | null>(null);
  const [isParseError, setIsParseError] = useState<boolean>(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const handler = setTimeout(() => {
      try {
        const res = analyze(source, optionsRef.current);
        setResult(res);
        if (res.errors && res.errors.length > 0) {
          setIsParseError(true);
        } else {
          setIsParseError(false);
          setLastValidResult(res);
        }
      } catch (err: unknown) {
        setIsParseError(true);
        const msg = err instanceof Error ? err.message : String(err);
        setResult({ errors: [msg] });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [source, JSON.stringify(options)]);

  return {
    result,
    lastValidResult,
    activeResult: isParseError ? lastValidResult : result,
    isParseError,
  };
}
