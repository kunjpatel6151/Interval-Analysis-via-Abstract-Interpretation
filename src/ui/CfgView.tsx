import React, { useMemo, useRef, useEffect, useState } from 'react';
import dagre from '@dagrejs/dagre';
import * as d3 from 'd3';
import { CFG, NodeId } from '../cfg/types';
import { SolveResult } from '../analysis/fixpoint';
import { statesAtStep, stepDiff } from '../analysis/replay';
import { lineSeverity, CheckResult } from '../analysis/checker';
import { prettyPrintAction } from '../cfg/printer';
import { intervalToString } from '../domain/interval';

export interface CfgViewProps {
  cfg: CFG | null;
  solveResult: SolveResult | null;
  checkResult: CheckResult | null;
  step: number;
  selectedNode: NodeId | null;
  onSelectNode: (nodeId: NodeId, sourceLine?: number) => void;
}

interface LayoutNode {
  id: NodeId;
  x: number;
  y: number;
  width: number;
  height: number;
  isLoopHead: boolean;
  isEntry: boolean;
  isExit: boolean;
  line: number;
}

interface LayoutEdge {
  id: number;
  from: NodeId;
  to: NodeId;
  points: { x: number; y: number }[];
  label: string;
  isBackEdge: boolean;
  line: number;
}

export const CfgView: React.FC<CfgViewProps> = ({
  cfg,
  solveResult,
  checkResult,
  step,
  selectedNode,
  onSelectNode,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [zoomScale, setZoomScale] = useState<number>(1);

  // 1. Compute Dagre Layout ONCE per CFG (useMemo)
  const layout = useMemo(() => {
    if (!cfg || cfg.nodes.length === 0) {
      return null;
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB',
      nodesep: 45,
      ranksep: 60,
      marginx: 30,
      marginy: 30,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes to Dagre
    for (const node of cfg.nodes) {
      const isLoopHead = cfg.loopHeads.includes(node.id);
      g.setNode(node.id.toString(), {
        width: 140,
        height: isLoopHead ? 80 : 70,
      });
    }

    // Identify back edges (rpoRank[from] > rpoRank[to])
    const rpoRank = new Map<NodeId, number>();
    cfg.nodes.forEach((n, idx) => rpoRank.set(n.id, idx));

    // Add edges to Dagre
    const layoutEdges: LayoutEdge[] = [];

    for (const edge of cfg.edges) {
      const fromRank = rpoRank.get(edge.from) ?? 0;
      const toRank = rpoRank.get(edge.to) ?? 0;
      const isBackEdge = fromRank > toRank;

      g.setEdge(edge.from.toString(), edge.to.toString());

      layoutEdges.push({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        points: [],
        label: prettyPrintAction(edge.action),
        isBackEdge,
        line: edge.line,
      });
    }

    dagre.layout(g);

    // Extract layout node coordinates
    const layoutNodes: LayoutNode[] = cfg.nodes.map((node) => {
      const dNode = g.node(node.id.toString());
      const isLoopHead = cfg.loopHeads.includes(node.id);

      // Find primary line for node
      const outEdges = cfg.succ.get(node.id) || [];
      const line = outEdges.length > 0 ? outEdges[0].line : 1;

      return {
        id: node.id,
        x: dNode.x,
        y: dNode.y,
        width: dNode.width,
        height: dNode.height,
        isLoopHead,
        isEntry: node.id === cfg.entry,
        isExit: node.id === cfg.exit,
        line,
      };
    });

    // Extract layout edge points
    for (const le of layoutEdges) {
      const dEdge = g.edge(le.from.toString(), le.to.toString());
      if (dEdge && dEdge.points) {
        le.points = dEdge.points;
      }
    }

    const graphInfo = g.graph();
    const graphWidth = graphInfo.width || 600;
    const graphHeight = graphInfo.height || 600;

    return {
      nodes: layoutNodes,
      edges: layoutEdges,
      width: graphWidth,
      height: graphHeight,
    };
  }, [cfg]);

  // 2. Setup D3 Zoom and Pan
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svg = d3.select(svgRef.current);
    const gContainer = d3.select(gRef.current);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 2.5])
      .on('zoom', (event) => {
        gContainer.attr('transform', event.transform.toString());
        setZoomScale(event.transform.k);
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;
  }, [layout]);

  // Zoom control buttons
  const handleFitToView = () => {
    if (!svgRef.current || !gRef.current || !layout || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    const clientWidth = svgRef.current.clientWidth || 600;
    const clientHeight = svgRef.current.clientHeight || 500;

    const scale = Math.min(
      (clientWidth - 40) / layout.width,
      (clientHeight - 40) / layout.height,
      1.2
    );

    const tx = (clientWidth - layout.width * scale) / 2;
    const ty = (clientHeight - layout.height * scale) / 2;

    svg
      .transition()
      .duration(400)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
  };

  const handleZoomIn = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current).transition().duration(200).call(zoomBehaviorRef.current.scaleBy, 1.2);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current).transition().duration(200).call(zoomBehaviorRef.current.scaleBy, 0.8);
    }
  };

  if (!cfg || !solveResult || !layout) {
    return (
      <div className="cfg-view-panel">
        <h3 className="panel-title">Control Flow Graph (CFG)</h3>
        <div className="empty-state">
          <p>No Control Flow Graph available.</p>
        </div>
      </div>
    );
  }

  const isLargeGraph = cfg.nodes.length > 60;
  const currentStates = statesAtStep(solveResult, step);
  const diff = stepDiff(solveResult, step);
  const isFinalStep = step >= (solveResult.trace ? solveResult.trace.length - 1 : 0);

  // Generate smooth SVG curve for edge points
  const lineGenerator = d3
    .line<{ x: number; y: number }>()
    .x((d) => d.x)
    .y((d) => d.y)
    .curve(d3.curveBasis);

  return (
    <div className="cfg-view-panel">
      <div className="panel-header">
        <h3 className="panel-title">Control Flow Graph (CFG)</h3>

        {/* Zoom Controls */}
        <div className="cfg-zoom-controls">
          <button type="button" className="btn btn-sm" onClick={handleFitToView} title="Fit to View">
            Fit View
          </button>
          <button type="button" className="btn btn-sm" onClick={handleZoomIn} title="Zoom In">
            +
          </button>
          <button type="button" className="btn btn-sm" onClick={handleZoomOut} title="Zoom Out">
            -
          </button>
          <span className="zoom-scale-badge">{Math.round(zoomScale * 100)}%</span>
        </div>
      </div>

      {/* Large Graph Warning */}
      {isLargeGraph && (
        <div className="banner banner-warning">
          ⚠️ Large CFG ({cfg.nodes.length} nodes): Transitions animation disabled for performance.
        </div>
      )}

      {/* SVG Container */}
      <div className="cfg-svg-container">
        <svg
          ref={svgRef}
          className="cfg-svg"
          width="100%"
          height="100%"
          tabIndex={0}
          aria-label="Control Flow Graph SVG visualizer"
        >
          <defs>
            {/* Arrowhead Marker */}
            <marker
              id="cfg-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
            </marker>

            {/* Active Highlight Arrowhead */}
            <marker
              id="cfg-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary-color)" />
            </marker>

            {/* Unreachable Hatched Pattern */}
            <pattern
              id="unreachable-hatch"
              width="8"
              height="8"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="8" stroke="var(--text-muted)" strokeWidth="2" opacity="0.3" />
            </pattern>
          </defs>

          <g ref={gRef}>
            {/* Render Edges */}
            {layout.edges.map((le) => {
              const pathD = le.points.length > 0 ? lineGenerator(le.points) : '';
              const isActiveEdge = diff && diff.edgeId === le.id;

              // Edge label position (midpoint)
              const midPoint =
                le.points.length > 1
                  ? le.points[Math.floor(le.points.length / 2)]
                  : { x: (le.from + le.to) * 10, y: 50 };

              return (
                <g key={le.id} className={`cfg-edge-group ${isActiveEdge ? 'active-edge' : ''}`}>
                  <path
                    d={pathD || ''}
                    className={`cfg-edge-path ${le.isBackEdge ? 'back-edge' : ''}`}
                    markerEnd={isActiveEdge ? 'url(#cfg-arrow-active)' : 'url(#cfg-arrow)'}
                  />

                  {/* Edge Label */}
                  {le.label && (
                    <g transform={`translate(${midPoint.x}, ${midPoint.y})`}>
                      <rect
                        x={-le.label.length * 3.5 - 4}
                        y="-10"
                        width={le.label.length * 7 + 8}
                        height="16"
                        rx="3"
                        className="edge-label-bg"
                      />
                      <text textAnchor="middle" y="2" className="edge-label-text">
                        {le.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Render Nodes */}
            {layout.nodes.map((node) => {
              const state = currentStates.get(node.id);
              const isUnreachable = !state || state.isUnreachable();

              const isChanged = diff && diff.node === node.id;
              const isWidened = isChanged && diff.widened;
              const isSelected = selectedNode === node.id;

              // Final step severity color for node fill
              let nodeSeverityClass = '';
              if (isFinalStep && checkResult) {
                const outEdges = cfg.succ.get(node.id) || [];
                const line = outEdges.length > 0 ? outEdges[0].line : 0;
                if (line > 0) {
                  const sev = lineSeverity(checkResult, line);
                  if (sev !== 'safe') {
                    nodeSeverityClass = `node-sev-${sev}`;
                  }
                }
              }

              // Compact variables formatting
              const varsStr =
                state && !isUnreachable
                  ? Array.from(state.getVars().entries())
                      .map(([k, v]) => `${k}∈${intervalToString(v)}`)
                      .join(' ')
                  : '⊥';

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`}
                  className={`cfg-node-group ${isSelected ? 'node-selected' : ''} ${
                    isChanged ? 'node-changed' : ''
                  } ${nodeSeverityClass}`}
                  onClick={() => onSelectNode(node.id, node.line)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectNode(node.id, node.line)}
                >
                  <title>{`Node ${node.id}${node.isLoopHead ? ' [Loop Head]' : ''}\nState: ${varsStr}`}</title>

                  {/* Outer rect (Double border for Loop Head) */}
                  {node.isLoopHead && (
                    <rect
                      x="-4"
                      y="-4"
                      width={node.width + 8}
                      height={node.height + 8}
                      rx="8"
                      className="node-loop-head-outer"
                    />
                  )}

                  {/* Node Rect */}
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="6"
                    className={`node-rect ${isUnreachable ? 'node-unreachable' : ''}`}
                  />

                  {/* Node Title Header */}
                  <text x="8" y="18" className="node-title">
                    Node {node.id}
                    {node.isEntry ? ' (entry)' : node.isExit ? ' (exit)' : ''}
                  </text>

                  {/* Tags */}
                  {node.isLoopHead && (
                    <text x={node.width - 8} y="18" textAnchor="end" className="tag-loop-head">
                      ↺ loop head
                    </text>
                  )}

                  {isWidened && (
                    <text x={node.width - 8} y={node.height - 8} textAnchor="end" className="tag-widened">
                      ∇ WIDENED
                    </text>
                  )}

                  {/* State Text */}
                  <text x="8" y="42" className="node-state-text">
                    {varsStr.length > 22 ? `${varsStr.slice(0, 20)}...` : varsStr}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend Footer */}
      <div className="cfg-legend">
        <span className="legend-item"><span className="legend-box box-safe"></span> Safe</span>
        <span className="legend-item"><span className="legend-box box-possible"></span> Possible</span>
        <span className="legend-item"><span className="legend-box box-definite"></span> Definite</span>
        <span className="legend-item"><span className="legend-box box-unreachable"></span> Unreachable</span>
        <span className="legend-item"><span className="legend-line line-back"></span> Back Edge</span>
      </div>
    </div>
  );
};
