import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import HomelabGuidePage from './homelab-guide-page';

const renderGuide = (path = '/how-to-build-a-homelab') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HomelabGuidePage />
    </MemoryRouter>,
  );

describe('Homelab Guide', () => {
  it('is one article: a title, then a section for each part of the subject', () => {
    renderGuide();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'How to build a homelab without turning it into a pile of random gear',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent),
    ).toEqual([
      'The practical order for building a homelab',
      'Starter homelab patterns',
      'Hardware advice that actually matters',
      'Network design basics for a real homelab',
      'Security and maintenance checklist',
      'How to use HLBuilder for homelab planning',
      'Frequently asked questions',
      'Use Google SSO with HLBuilder',
    ]);
    expect(document.title).toBe('How to Build a Homelab with HLBuilder');
  });

  it('sets the starter patterns side by side, to compare', () => {
    renderGuide();
    const patterns = screen.getByRole('region', { name: 'Starter homelab patterns' });

    expect(
      within(patterns)
        .getAllByRole('rowheader')
        .map(header => header.textContent),
    ).toEqual(['Budget homelab', 'Balanced homelab', 'Virtualization lab']);
  });

  it('numbers what happens in order, and only that', () => {
    renderGuide();

    const order = screen.getByRole('region', {
      name: 'The practical order for building a homelab',
    });
    expect(within(order).getAllByRole('listitem')).toHaveLength(4);
    expect(within(order).getByRole('list').tagName).toBe('OL');
    // Questions have no order.
    const questions = screen.getByRole('region', { name: 'Frequently asked questions' });
    expect(within(questions).queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps the sign-in setup folded away until it is asked for', async () => {
    const user = userEvent.setup();
    renderGuide();
    const setup = screen
      .getByText('Setup steps, environment values and troubleshooting')
      .closest('details')!;

    expect(setup).not.toHaveAttribute('open');
    await user.click(screen.getByText('Setup steps, environment values and troubleshooting'));
    expect(setup).toHaveAttribute('open');
    // One value switches sign-in on; the frontend is given it by the backend.
    expect(within(setup).getByText(/^GOOGLE_CLIENT_ID=/)).toBeInTheDocument();
    expect(within(setup).queryByText(/^VITE_GOOGLE_CLIENT_ID=/)).not.toBeInTheDocument();
  });

  it('opens the sign-in setup when a link points into it', () => {
    renderGuide('/how-to-build-a-homelab#sso-env');

    expect(
      screen.getByText('Setup steps, environment values and troubleshooting').closest('details'),
    ).toHaveAttribute('open');
  });

  it('links on to the app and its two catalogs', () => {
    renderGuide();

    expect(screen.getByRole('link', { name: 'Open HLBuilder' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Browse the hardware catalog' })).toHaveAttribute(
      'href',
      '/hardware',
    );
    expect(screen.getByRole('link', { name: 'Browse the service library' })).toHaveAttribute(
      'href',
      '/services',
    );
  });
});
