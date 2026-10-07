import { Link } from 'react-router-dom';
import type { BuildKind } from '../../../types';
import { BUILD_KINDS } from '../../gaming/lib/kind';
import { AsciiRack } from '../../landing/components/ascii-rack';

const PLANNER: Record<BuildKind, string> = {
  homelab: '/planner',
  lan_party: '/planner?kind=lan_party',
  game_server: '/planner?kind=game_server',
};

type FirstProjectProps = {
  onCreateEmpty: () => void;
  onImport: () => void;
};

/**
 * The projects page before there is a project: on a fresh instance this is the
 * first thing its owner sees. Three ways into the guided planner, and the two
 * ways around it.
 */
export function FirstProject({ onCreateEmpty, onImport }: FirstProjectProps) {
  return (
    <section className="grid items-center gap-10 py-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          What do you want to plan?
        </h2>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Pick one and answer a few questions. You get a wired build with addresses, ready to
          refine on the canvas.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {BUILD_KINDS.map(({ kind, label, description }) => (
            <Link
              key={kind}
              to={PLANNER[kind]}
              className="app-card flex flex-col gap-1 p-4 transition-colors hover:border-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="font-medium">{label}</span>
              <span className="text-sm leading-snug text-muted-foreground">{description}</span>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Or{' '}
          <button
            type="button"
            onClick={onCreateEmpty}
            className="app-link text-foreground hover:cursor-pointer"
          >
            start with an empty canvas
          </button>
          , or{' '}
          <button
            type="button"
            onClick={onImport}
            className="app-link text-foreground hover:cursor-pointer"
          >
            import a project file
          </button>
          .
        </p>
      </div>
      <div className="lp-rack-slot hidden lg:block">
        <AsciiRack />
      </div>
    </section>
  );
}
