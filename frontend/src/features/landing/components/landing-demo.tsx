import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '../../../lib/utils';
import { CanvasGrid } from '../../builder/components/canvas-grid';
import { useCanvasMoving } from '../../builder/hooks/use-canvas-moving';
import { CustomEdge } from '../../builder/components/custom-edge';
import { HardwareNode } from '../../builder/components/hardware-node';
import { computeLayout, type LayoutStyle } from '../../builder/lib/layout';
import { layoutGraphFromFlow } from '../../builder/lib/layout/from-flow';
import { GOAL_LABELS, type Budget, type Goal } from '../../builder/lib/planner/types';
import {
  DEFAULT_HOMELAB,
  DEFAULT_PARTY,
  homelabDemo,
  partyDemo,
  type DemoPlan,
  type DemoScenario,
  type HomelabDemoAnswers,
  type PartyDemoAnswers,
} from '../lib/demo-plan';

const nodeTypes: NodeTypes = { hardware: HardwareNode };
const edgeTypes = { custom: CustomEdge };

/** As long as `.is-arranging` in index.css lets the cards glide. */
const GLIDE_MS = 460;
const FIT = { padding: 0.12, duration: 350 };

const GOALS = Object.keys(GOAL_LABELS) as Goal[];
const BUDGETS: Array<{ id: Budget; label: string }> = [
  { id: 'starter', label: 'Starter' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'enthusiast', label: 'Enthusiast' },
];

type DemoCanvasProps = {
  plan: DemoPlan;
  onKeep: () => void;
};

function DemoCanvas({ plan, onKeep }: DemoCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(plan.nodes);
  const [shown, setShown] = useState(plan);
  const [style, setStyle] = useState<LayoutStyle>('hierarchy');
  const [arranging, setArranging] = useState(false);
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();

  // A new plan replaces the canvas. Set while rendering, so the cards of the old
  // plan are never drawn with the cables of the new one.
  if (shown !== plan) {
    setShown(plan);
    setNodes(plan.nodes);
  }

  /** The cards where Polish would put them, from the sizes they were measured at. */
  const arranged = (current: Node[], layoutStyle: LayoutStyle) => {
    const graph = layoutGraphFromFlow(current, plan.edges, plan.hardwareNodes);
    const target = new Map(
      computeLayout(graph, { style: layoutStyle }).positions.map(position => [
        position.id,
        position,
      ]),
    );
    return current.map(node => {
      const to = target.get(node.id);
      return to ? { ...node, position: { x: to.x, y: to.y } } : node;
    });
  };

  // The planner places a plan from estimated card sizes. Once the cards have
  // been measured, arrange each plan once more from the real ones, then fit it.
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasMoving = useCanvasMoving(canvasRef);
  const settled = useRef<DemoPlan | null>(null);
  useEffect(() => {
    if (!initialized) return;
    let fit = 0;
    const frame = requestAnimationFrame(() => {
      if (settled.current !== plan) {
        settled.current = plan;
        setNodes(current => arranged(current, style));
      }
      fit = requestAnimationFrame(() => void fitView(FIT));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(fit);
    };
    // `arranged` reads the plan and the style, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, plan, style, fitView, setNodes]);

  const glide = (next: (current: Node[]) => Node[]) => {
    setArranging(true);
    setNodes(next);
    window.setTimeout(() => {
      setArranging(false);
      void fitView(FIT);
    }, GLIDE_MS);
  };

  const polish = (layoutStyle: LayoutStyle) => {
    setStyle(layoutStyle);
    glide(current => arranged(current, layoutStyle));
  };

  const scatter = () => {
    const columns = Math.ceil(Math.sqrt(nodes.length * 1.6));
    const order = nodes.map((_, index) => index).sort(() => Math.random() - 0.5);
    glide(current =>
      current.map((node, index) => ({
        ...node,
        position: {
          x: (order[index] % columns) * 300 + Math.round(Math.random() * 80),
          y: Math.floor(order[index] / columns) * 230 + Math.round(Math.random() * 80),
        },
      })),
    );
  };

  return (
    <div className="lp-demo-stage">
      <div className="lp-demo-toolbar">
        <button type="button" className="lp-button is-small" onClick={scatter}>
          Scatter
        </button>
        <button type="button" className="lp-button is-primary is-small" onClick={() => polish(style)}>
          Polish
        </button>
        <div className="lp-segment" role="group" aria-label="Layout style">
          {(['hierarchy', 'compact'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={style === option}
              onClick={() => polish(option)}
            >
              {option === 'hierarchy' ? 'Hierarchy' : 'Compact'}
            </button>
          ))}
        </div>
        <span className="lp-demo-hint">Drag a device, then press Polish.</span>
      </div>

      <div className="lp-demo-canvas" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={plan.edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={FIT}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          minZoom={0.15}
          onMoveStart={canvasMoving.onMoveStart}
          onMoveEnd={canvasMoving.onMoveEnd}
          proOptions={{ hideAttribution: true }}
          className={cn('builder-flow-canvas', arranging && 'is-arranging')}
        >
          <CanvasGrid gap={20} opacity={0.16} />
        </ReactFlow>
      </div>

      <dl className="lp-demo-figures">
        {plan.stats.map(stat => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>
              <b>{stat.value}</b>
              {stat.hint && <small>{stat.hint}</small>}
            </dd>
          </div>
        ))}
        <div className="lp-demo-keep">
          <button type="button" className="lp-button is-small" onClick={onKeep}>
            Keep this plan
          </button>
        </div>
      </dl>
    </div>
  );
}

type LandingDemoProps = {
  /** The visitor wants to keep what the demo shows: sign in and open that planner. */
  onKeep: (scenario: DemoScenario) => void;
};

/**
 * The guided planner, the builder's own cards and the Polish engine, running in
 * the browser with nothing saved. What it draws is what a new project opens with.
 */
export default function LandingDemo({ onKeep }: LandingDemoProps) {
  const [scenario, setScenario] = useState<DemoScenario>('homelab');
  const [homelab, setHomelab] = useState<HomelabDemoAnswers>(DEFAULT_HOMELAB);
  const [party, setParty] = useState<PartyDemoAnswers>(DEFAULT_PARTY);

  const plan = useMemo(
    () => (scenario === 'homelab' ? homelabDemo(homelab) : partyDemo(party)),
    [scenario, homelab, party],
  );

  const toggleGoal = (goal: Goal) =>
    setHomelab(current => {
      const goals = current.goals.includes(goal)
        ? current.goals.filter(item => item !== goal)
        : [...current.goals, goal];
      // The planner needs something to plan for.
      return goals.length > 0 ? { ...current, goals } : current;
    });

  return (
    <div className="lp-demo">
      <div className="lp-demo-controls">
        <div className="lp-tabs" role="tablist" aria-label="What to plan">
          <button
            type="button"
            role="tab"
            aria-selected={scenario === 'homelab'}
            onClick={() => setScenario('homelab')}
          >
            Homelab
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scenario === 'lan_party'}
            onClick={() => setScenario('lan_party')}
          >
            LAN party
          </button>
        </div>

        {scenario === 'homelab' ? (
          <div className="lp-demo-form" role="tabpanel">
            <fieldset>
              <legend>What should it do?</legend>
              <div className="lp-chips">
                {GOALS.map(goal => (
                  <button
                    key={goal}
                    type="button"
                    aria-pressed={homelab.goals.includes(goal)}
                    onClick={() => toggleGoal(goal)}
                  >
                    {GOAL_LABELS[goal]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Budget</legend>
              <div className="lp-segment">
                {BUDGETS.map(budget => (
                  <button
                    key={budget.id}
                    type="button"
                    aria-pressed={homelab.budget === budget.id}
                    onClick={() => setHomelab(current => ({ ...current, budget: budget.id }))}
                  >
                    {budget.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="lp-check">
              <input
                type="checkbox"
                checked={homelab.resilient}
                onChange={event =>
                  setHomelab(current => ({ ...current, resilient: event.target.checked }))
                }
              />
              Second node and a UPS
            </label>
          </div>
        ) : (
          <div className="lp-demo-form" role="tabpanel">
            <label className="lp-range">
              <span>
                Players <output>{party.seats}</output>
              </span>
              <input
                type="range"
                min={4}
                max={64}
                step={4}
                value={party.seats}
                onChange={event =>
                  setParty(current => ({ ...current, seats: Number(event.target.value) }))
                }
              />
            </label>
            <label className="lp-range">
              <span>
                Consoles <output>{party.consoles}</output>
              </span>
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                value={party.consoles}
                onChange={event =>
                  setParty(current => ({ ...current, consoles: Number(event.target.value) }))
                }
              />
            </label>
            <fieldset>
              <legend>Wall sockets</legend>
              <div className="lp-segment">
                <button
                  type="button"
                  aria-pressed={party.mains === 'eu'}
                  onClick={() => setParty(current => ({ ...current, mains: 'eu' }))}
                >
                  230 V, 16 A
                </button>
                <button
                  type="button"
                  aria-pressed={party.mains === 'us'}
                  onClick={() => setParty(current => ({ ...current, mains: 'us' }))}
                >
                  120 V, 15 A
                </button>
              </div>
            </fieldset>
            <label className="lp-check">
              <input
                type="checkbox"
                checked={party.wifi}
                onChange={event =>
                  setParty(current => ({ ...current, wifi: event.target.checked }))
                }
              />
              Wi-Fi for phones and handhelds
            </label>
          </div>
        )}

        <p className="lp-demo-note">
          Runs in your browser with the planner, the device cards and the layout engine of the
          real builder. Nothing is saved or sent anywhere.
        </p>
      </div>

      <ReactFlowProvider>
        <DemoCanvas plan={plan} onKeep={() => onKeep(scenario)} />
      </ReactFlowProvider>
    </div>
  );
}
