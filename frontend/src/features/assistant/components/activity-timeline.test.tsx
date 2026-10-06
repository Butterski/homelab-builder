import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDuration } from '../lib/format-duration';
import type { ToolStep } from '../store/assistant-store';
import { ActivityTimeline } from './activity-timeline';

const step = (key: string, extra: Partial<ToolStep> = {}): ToolStep => ({
  key,
  id: key,
  name: 'get_build',
  title: 'Read a build',
  status: 'ok',
  ...extra,
});

describe('formatDuration', () => {
  it('says how long a step took the way a person would', () => {
    expect(formatDuration(8)).toBe('0.1 s');
    expect(formatDuration(430)).toBe('0.4 s');
    expect(formatDuration(2449)).toBe('2.4 s');
    expect(formatDuration(12_400)).toBe('12 s');
  });
});

describe('ActivityTimeline', () => {
  it('shows every step while the assistant works, the current one with its progress', () => {
    render(
      <ActivityTimeline
        live
        steps={[
          step('a', { summary: '14 devices, 13 connections', durationMs: 31 }),
          step('b', { name: 'propose_changes', title: 'Propose changes to a build', status: 'writing', bytes: 2100 }),
        ]}
      />,
    );

    const rows = screen.getAllByTestId('tool-step');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Read a build');
    expect(rows[0]).toHaveTextContent('14 devices, 13 connections · 0.1 s');
    expect(rows[1]).toHaveAttribute('data-status', 'writing');
    expect(rows[1]).toHaveTextContent('writing… 2.1 kB');
    expect(rows[1]).toHaveClass('is-active');
    // Nothing to fold while it is still growing.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('folds the steps of a finished turn into one line that opens', async () => {
    const user = userEvent.setup();
    render(
      <ActivityTimeline
        live={false}
        steps={[
          step('a', { durationMs: 300 }),
          step('b', { name: 'search_hardware', title: 'Search the hardware catalog', detail: '2.5G switch', summary: '6 results', durationMs: 900 }),
          step('c', { name: 'propose_changes', title: 'Propose changes to a build', status: 'error', error: 'operations[1] (connect): no free port' }),
        ]}
      />,
    );

    const summary = screen.getByRole('button', { name: '3 steps · 1 failed · 1.2 s' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();

    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByTestId('tool-step');
    expect(rows[1]).toHaveTextContent('2.5G switch · 6 results · 0.9 s');
    expect(rows[2]).toHaveTextContent('operations[1] (connect): no free port');

    await user.click(summary);
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('shows a single finished step as itself', () => {
    render(<ActivityTimeline live={false} steps={[step('a', { status: 'stopped' })]} />);
    expect(screen.getByTestId('tool-step')).toHaveAttribute('data-status', 'stopped');
    expect(screen.getByText('(not finished)')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing without steps', () => {
    const { container } = render(<ActivityTimeline live steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
