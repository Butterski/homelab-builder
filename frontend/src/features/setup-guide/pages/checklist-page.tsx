import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '../../../components/layout/page';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { Button } from '../../../components/ui/button';
import { LoadingScreen } from '../../../components/ui/loading-screen';
import { TickBox } from '../../../components/ui/tick-box';
import { cn } from '../../../lib/utils';
import { useCurrentProject } from '../../builder/hooks/use-current-project';
import { startAutosave } from '../../builder/store/autosave';
import { useBuilderStore } from '../../builder/store/builder-store';
import {
  buildSetupPlan,
  linksFromEdges,
  readSetupDone,
  sectionStepIds,
  setupProgress,
  type SetupSection,
  type SetupStep,
  type SetupTable,
} from '../lib/setup-plan';

const SEO = (
  <SeoMeta
    title="Setup Guide | HLBuilder"
    description="The setup steps of your build: cables, addresses and what to install on each host."
    path="/checklist"
  />
);

/** How many cells the text meter is wide. */
const METER_CELLS = 24;

/** An id that can be used as an anchor: section ids hold colons and uuids. */
const anchorOf = (sectionId: string) => `setup-${sectionId.replace(/[^a-zA-Z0-9]+/g, '-')}`;

/** Shown when there is nothing to write a guide from: no project, or an empty one. */
function EmptyGuide({ projectId }: { projectId: string | null }) {
  return (
    <Page width="narrow">
      {SEO}
      <PageHeader
        title="Setup Guide"
        lede={
          projectId
            ? 'The guide is written from the devices and services on the canvas. This project has none yet.'
            : 'The guide is written for one project. Open or create one, then come back here.'
        }
      />
      <div className="pt-6">
        <Button asChild>
          <Link to={projectId ? `/builder/${projectId}` : '/'}>
            {projectId ? 'Open the canvas' : 'Go to Projects'}
          </Link>
        </Button>
      </div>
    </Page>
  );
}

/** Progress the way a terminal shows it: a row of cells filling up. */
function Meter({ done, total }: { done: number; total: number }) {
  const filled = total > 0 ? Math.round((done / total) * METER_CELLS) : 0;
  return (
    <div
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} done`}
    >
      <p className="text-sm">
        <span className="font-semibold">{done}</span>
        <span className="text-muted-foreground"> of {total} done</span>
      </p>
      <p
        className="mt-1 select-none whitespace-nowrap font-mono text-[0.8125rem] leading-none text-muted-foreground"
        aria-hidden="true"
      >
        [<span className="text-foreground">{'#'.repeat(filled)}</span>
        {'.'.repeat(METER_CELLS - filled)}]
      </p>
    </div>
  );
}

/** A command as it is typed, with a way to take it along. */
function Command({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy. Select the text instead.');
    }
  };
  return (
    <div className="relative mt-2.5">
      <pre className="app-code pr-16">{code}</pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-1.5 top-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:cursor-pointer hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring print:hidden"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Addresses, with or without a network length or a port, as they stand in a sentence. */
const ADDRESS = /(\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?(?::\d{1,5})?\b)/;

/** A sentence with its addresses set in the monospace face, where they are compared by eye. */
function Sentence({ text }: { text: string }) {
  return (
    <>
      {text.split(ADDRESS).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="app-figure">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Steps({
  steps,
  done,
  onToggle,
}: {
  steps: SetupStep[];
  done: Set<string>;
  onToggle: (id: string) => void;
}) {
  const prefix = useId();
  return (
    <ul className="mt-4 grid">
      {steps.map(step => {
        const ticked = done.has(step.id);
        const inputId = `${prefix}-${step.id}`;
        return (
          <li
            key={step.id}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)] border-t py-3 first:border-t-0 first:pt-0 print:break-inside-avoid"
          >
            <TickBox
              id={inputId}
              className="mt-[0.25rem]"
              checked={ticked}
              onChange={() => onToggle(step.id)}
            />
            <div className="min-w-0">
              <label
                htmlFor={inputId}
                className={cn('block hover:cursor-pointer', ticked && 'text-muted-foreground')}
              >
                <Sentence text={step.text} />
              </label>
              {step.action && (
                <Link
                  to={step.action.to}
                  className="app-link mt-1 inline-block text-sm print:hidden"
                >
                  {step.action.label}
                </Link>
              )}
              {step.code && <Command code={step.code} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Rows({
  table,
  done,
  onToggle,
}: {
  table: SetupTable;
  done: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="app-table-scroll mt-4">
      {/* A wide table scrolls sideways on a phone instead of breaking every name into three lines. */}
      <table
        className={cn(
          'app-table [&_:is(td,th)]:align-middle',
          table.columns.length >= 4 && 'min-w-[32rem] print:min-w-0',
        )}
      >
        <caption className="sr-only">{table.caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-7">
              <span className="sr-only">Done</span>
            </th>
            {table.columns.map(column => (
              <th key={column.label} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(row => {
            const ticked = done.has(row.id);
            return (
              <tr
                key={row.id}
                className={cn('print:break-inside-avoid', ticked && 'text-muted-foreground')}
              >
                <td>
                  <TickBox
                    aria-label={row.label}
                    checked={ticked}
                    onChange={() => onToggle(row.id)}
                  />
                </td>
                {row.cells.map((cell, index) => (
                  <td key={index} className={cn(cell.figure && 'is-figure')}>
                    {cell.href ? (
                      <a href={cell.href} target="_blank" rel="noreferrer" className="app-link">
                        {cell.text}
                      </a>
                    ) : (
                      cell.text
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionBlock({
  section,
  number,
  done,
  onToggle,
}: {
  section: SetupSection;
  number: number;
  done: Set<string>;
  onToggle: (id: string) => void;
}) {
  const ids = sectionStepIds(section);
  const count = ids.filter(id => done.has(id)).length;
  const anchor = anchorOf(section.id);
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="scroll-mt-6 border-t py-8 first:border-t-0 first:pt-0"
    >
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="app-figure text-sm text-muted-foreground" aria-hidden="true">
            {number}
          </span>
          <h2 id={`${anchor}-title`} className="text-lg font-semibold">
            {section.title}
          </h2>
        </div>
        {ids.length > 0 && (
          <span className="app-figure shrink-0 text-xs text-muted-foreground">
            {count}/{ids.length}
          </span>
        )}
      </header>
      {section.intro && (
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          <Sentence text={section.intro} />
        </p>
      )}
      {section.warning && (
        <p role="note" className="mt-4 flex max-w-2xl gap-2.5 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warn" aria-hidden="true" />
          <span>
            <Sentence text={section.warning} />
          </span>
        </p>
      )}
      {section.steps.length > 0 && <Steps steps={section.steps} done={done} onToggle={onToggle} />}
      {section.table && <Rows table={section.table} done={done} onToggle={onToggle} />}
      {section.note && (
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          <Sentence text={section.note} />
        </p>
      )}
    </section>
  );
}

export default function ChecklistPage() {
  // The guide is about the open project; after a reload its canvas is fetched again.
  const project = useCurrentProject();
  const hardwareNodes = useBuilderStore(state => state.hardwareNodes);
  const edges = useBuilderStore(state => state.edges);
  const gamingPlan = useBuilderStore(state => state.gamingPlan);
  const availableServices = useBuilderStore(state => state.availableServices);
  const fetchServices = useBuilderStore(state => state.fetchServices);
  const buildSettings = useBuilderStore(state => state.buildSettings);
  const setSetupDone = useBuilderStore(state => state.setSetupDone);

  // Game servers and links to a service's own documentation come from the catalog.
  useEffect(() => {
    if (useBuilderStore.getState().availableServices.length === 0) void fetchServices();
  }, [fetchServices]);

  // What is ticked off is part of the build: it is saved the way an edit on the canvas is.
  useEffect(
    () =>
      startAutosave({
        onConflict: () =>
          toast.info('This project was changed elsewhere and has been loaded again.'),
        onFailure: message => toast.error(message),
      }),
    [],
  );

  const sections = useMemo(
    () =>
      buildSetupPlan({
        nodes: hardwareNodes,
        links: linksFromEdges(edges),
        services: availableServices,
        gamingPlan,
      }),
    [hardwareNodes, edges, availableServices, gamingPlan],
  );
  const done = useMemo(() => new Set(readSetupDone(buildSettings)), [buildSettings]);
  const progress = useMemo(() => setupProgress(sections, done), [sections, done]);

  if (project.loading) {
    return <LoadingScreen message="Opening project…" />;
  }
  if (project.failed) {
    return (
      <Page width="narrow">
        {SEO}
        <PageHeader title="Setup Guide" lede="The project could not be loaded." />
        <div className="pt-6">
          <Button variant="outline" onClick={project.retry}>
            Try again
          </Button>
        </div>
      </Page>
    );
  }
  if (!project.id || hardwareNodes.length === 0) {
    return <EmptyGuide projectId={project.id} />;
  }

  /** Ticks are kept in the order of the guide, and only for steps it still has. */
  const store = (ticked: Set<string>) =>
    setSetupDone(sections.flatMap(sectionStepIds).filter(id => ticked.has(id)));
  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    store(next);
  };

  const services = hardwareNodes.reduce((sum, node) => sum + (node.vms?.length ?? 0), 0);
  const devices = hardwareNodes.filter(node => node.type !== 'rack').length;

  return (
    <Page width="article" className="pb-24">
      {SEO}
      <PageHeader
        title="Setup Guide"
        lede={
          <>
            Written from <span className="text-foreground">{project.name || 'this project'}</span>:{' '}
            {devices} {devices === 1 ? 'device' : 'devices'}
            {services > 0 && ` and ${services} ${services === 1 ? 'service' : 'services'}`}. It
            changes when the canvas does. What you tick off is saved with the project.
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} className="print:hidden">
              Print
            </Button>
            <Button variant="outline" asChild className="print:hidden">
              <Link to={`/builder/${project.id}`}>Open the canvas</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-x-12 gap-y-8 pt-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          aria-label="Progress and sections"
          className="grid h-fit gap-5 lg:sticky lg:top-6 print:hidden"
        >
          <Meter done={progress.done} total={progress.total} />
          <nav aria-label="Sections of the guide">
            <ol className="grid gap-0.5 text-sm">
              {sections.map((section, index) => {
                const count = progress.sections.get(section.id);
                const complete = !!count && count.total > 0 && count.done === count.total;
                return (
                  <li key={section.id}>
                    <a
                      href={`#${anchorOf(section.id)}`}
                      className={cn(
                        '-mx-2 flex items-baseline gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                        complete && 'text-muted-foreground',
                      )}
                    >
                      <span className="app-figure w-4 shrink-0 text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{section.title}</span>
                      {count && count.total > 0 && (
                        <span className="app-figure shrink-0 text-xs text-muted-foreground">
                          {count.done}/{count.total}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
          {progress.done > 0 && (
            <button
              type="button"
              onClick={() => store(new Set())}
              className="app-link w-fit text-sm text-muted-foreground hover:cursor-pointer hover:text-foreground"
            >
              Untick everything
            </button>
          )}
        </aside>

        <div className="min-w-0">
          {sections.map((section, index) => (
            <SectionBlock
              key={section.id}
              section={section}
              number={index + 1}
              done={done}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>
    </Page>
  );
}
