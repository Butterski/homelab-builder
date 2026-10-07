import { Fragment, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Heart } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { Service } from '../../../types';
import {
  categoryLabel,
  formatCores,
  formatDisk,
  formatRam,
  parseTags,
  serviceVisibilityLabel,
  type ServiceSort,
  type ServiceSortKey,
} from '../lib/service-catalog';

type ServiceTableProps = {
  services: Service[];
  sort: ServiceSort;
  onSort: (key: ServiceSortKey) => void;
  /** Left out when every row is of one category anyway. */
  showCategory?: boolean;
  /** Left out for a visitor without an account, who has no favorites to keep. */
  favorites?: {
    has: (serviceId: string) => boolean;
    toggle: (service: Service) => void;
  };
};

const COLUMNS: Array<{ key: ServiceSortKey; label: string; figure?: boolean; className?: string }> =
  [
    { key: 'name', label: 'Service' },
    { key: 'ram', label: 'RAM', figure: true },
    { key: 'cpu', label: 'Cores', figure: true, className: 'hidden sm:table-cell' },
    { key: 'disk', label: 'Disk', figure: true, className: 'hidden md:table-cell' },
  ];

/**
 * The library as rows to scan: a service, where it belongs and the least it
 * needs to run. A row opens to the rest of what is known about the service.
 */
export function ServiceTable({
  services,
  sort,
  onSort,
  showCategory = true,
  favorites,
}: ServiceTableProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const columnCount = COLUMNS.length + 1 + (showCategory ? 1 : 0) + (favorites ? 1 : 0);

  return (
    <table className="app-table [&_:is(td,th)]:align-middle">
      <caption className="sr-only">
        Self-hosted services with the minimum memory, processor cores and disk each one needs
      </caption>
      <thead>
        <tr>
          {favorites && (
            <th scope="col" className="w-8">
              <span className="sr-only">Favorite</span>
            </th>
          )}
          {COLUMNS.map(column => {
            const active = sort.key === column.key;
            const Arrow = sort.descending ? ArrowDown : ArrowUp;
            return (
              <th
                key={column.key}
                scope="col"
                aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                className={cn(column.figure && 'is-end', column.className)}
              >
                <button
                  type="button"
                  onClick={() => onSort(column.key)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm transition-colors hover:cursor-pointer hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    active && 'text-foreground',
                  )}
                >
                  {column.label}
                  <Arrow className={cn('size-3', !active && 'invisible')} aria-hidden="true" />
                </button>
              </th>
            );
          })}
          {showCategory && (
            <th scope="col" className="hidden lg:table-cell">
              Category
            </th>
          )}
          <th scope="col" className="w-6">
            <span className="sr-only">Details</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {services.map(service => {
          const open = openId === service.id;
          const needs = service.requirements;
          const visibility = serviceVisibilityLabel(service);
          const isFavorite = favorites?.has(service.id) ?? false;
          return (
            <Fragment key={service.id}>
              <tr
                className={cn(
                  'group cursor-pointer transition-colors hover:bg-muted/40',
                  open && '[&>*]:border-b-transparent',
                )}
                onClick={() => setOpenId(open ? null : service.id)}
              >
                {favorites && (
                  <td>
                    <button
                      type="button"
                      aria-pressed={isFavorite}
                      aria-label={
                        isFavorite
                          ? `Remove ${service.name} from favorites`
                          : `Add ${service.name} to favorites`
                      }
                      onClick={event => {
                        event.stopPropagation();
                        favorites.toggle(service);
                      }}
                      className={cn(
                        'grid size-7 place-items-center rounded-md transition-colors hover:cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                        isFavorite
                          ? 'text-foreground'
                          : 'text-muted-foreground/45 hover:text-foreground group-hover:text-muted-foreground',
                      )}
                    >
                      <Heart
                        className={cn('size-4', isFavorite && 'fill-current')}
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                )}
                <th scope="row" className="w-full max-w-0">
                  {/* One line: the name, then what it is, like a subject and its first words. */}
                  <span className="flex items-baseline gap-3">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`service-${service.id}`}
                      onClick={event => {
                        event.stopPropagation();
                        setOpenId(open ? null : service.id);
                      }}
                      className="max-w-full shrink-0 truncate rounded-sm text-left hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {service.name}
                    </button>
                    {visibility && (
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        {visibility}
                      </span>
                    )}
                    {!open && (
                      <span className="hidden min-w-0 truncate text-[0.8125rem] font-normal text-muted-foreground xl:block">
                        {service.description}
                      </span>
                    )}
                  </span>
                </th>
                <td className="is-figure is-end">{formatRam(needs?.min_ram_mb)}</td>
                <td className="is-figure is-end hidden sm:table-cell">
                  {formatCores(needs?.min_cpu_cores)}
                </td>
                <td className="is-figure is-end hidden md:table-cell">
                  {formatDisk(needs?.min_storage_gb)}
                </td>
                {showCategory && (
                  <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    {categoryLabel(service.category)}
                  </td>
                )}
                <td>
                  <ChevronRight
                    className={cn(
                      'size-4 text-muted-foreground/60 transition-transform',
                      open && 'rotate-90',
                    )}
                    aria-hidden="true"
                  />
                </td>
              </tr>
              {open && (
                <tr id={`service-${service.id}`}>
                  {favorites && <td />}
                  <td colSpan={columnCount - (favorites ? 1 : 0)} className="pb-6 pt-0">
                    <ServiceDetails service={service} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function ServiceDetails({ service }: { service: Service }) {
  const needs = service.requirements;
  const tags = parseTags(service.tags);
  const game = service.game;
  const links = [
    { label: 'Website', href: service.official_website },
    { label: 'Documentation', href: service.docs_url },
    { label: 'Source', href: service.github_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  const facts: Array<{ term: string; value: string }> = [
    { term: 'Category', value: categoryLabel(service.category) },
    { term: 'Runs in', value: service.docker_support ? 'Docker' : 'A VM or the host itself' },
  ];
  if (game?.role === 'game') {
    facts.push({
      term: 'Players',
      value:
        game.default_players === game.max_players
          ? `${game.max_players}`
          : `${game.default_players} planned, up to ${game.max_players}`,
    });
  }
  if (tags.length > 0) facts.push({ term: 'Tags', value: tags.join(', ') });

  return (
    <div className="grid max-w-3xl gap-5">
      <p className="text-muted-foreground">{service.description || 'No description yet.'}</p>

      <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {needs && (
          <table className="app-table h-fit">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col" className="is-end">
                  Minimum
                </th>
                <th scope="col" className="is-end">
                  Recommended
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="font-normal text-muted-foreground">
                  RAM
                </th>
                <td className="is-figure is-end">{formatRam(needs.min_ram_mb)}</td>
                <td className="is-figure is-end">{formatRam(needs.recommended_ram_mb)}</td>
              </tr>
              <tr>
                <th scope="row" className="font-normal text-muted-foreground">
                  CPU cores
                </th>
                <td className="is-figure is-end">{formatCores(needs.min_cpu_cores)}</td>
                <td className="is-figure is-end">{formatCores(needs.recommended_cpu_cores)}</td>
              </tr>
              <tr>
                <th scope="row" className="font-normal text-muted-foreground">
                  Disk
                </th>
                <td className="is-figure is-end">{formatDisk(needs.min_storage_gb)}</td>
                <td className="is-figure is-end">{formatDisk(needs.recommended_storage_gb)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <dl className="grid h-fit text-sm">
          {facts.map(fact => (
            <div
              key={fact.term}
              className="flex justify-between gap-6 border-b py-[0.6rem] first:border-t sm:first:border-t-0"
            >
              <dt className="shrink-0 text-muted-foreground">{fact.term}</dt>
              <dd className="text-right">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {game && game.ports.length > 0 && (
        <div className="grid gap-1.5">
          <h4 className="text-sm text-muted-foreground">
            Ports
            {game.ports.some(port => port.forward) &&
              ', and which ones a player outside your network needs'}
          </h4>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {game.ports.map(port => (
              <li
                key={`${port.name}-${port.port}-${port.proto}`}
                className="app-figure text-[0.8125rem]"
              >
                {port.port}/{port.proto}
                {port.forward && <span className="font-sans text-muted-foreground"> forward</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {game?.notes && <p className="text-sm text-muted-foreground">{game.notes}</p>}

      {links.length > 0 && (
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {links.map(link => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="app-link"
            >
              {link.label}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
