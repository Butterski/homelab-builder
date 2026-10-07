import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANDING_SCROLLER_ATTRIBUTE } from '../../../lib/prerender';
import { render as prerender } from '../../../prerender';
import { FAQS } from '../lib/content';
import LandingPage from './landing-page';

vi.mock('../../../components/auth/google-login-button', () => ({
  GoogleLoginButton: () => <button type="button">Sign in with Google</button>,
}));

// The demo brings React Flow; these tests are about the page around it.
vi.mock('../components/landing-demo', () => ({
  default: () => <div>demo canvas</div>,
}));

class NeverIntersects {
  observe() {}
  disconnect() {}
}

/** Draws the page and waits for the sign-in button, which is loaded on its own. */
async function renderPage() {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: 'Sign in with Google' });
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', NeverIntersects);
    // A cached count keeps the page from asking GitHub.
    sessionStorage.setItem('hlb-stars', '280');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.getElementById('prerender')?.remove();
  });

  it('says what the product is in one heading and one sentence', async () => {
    await renderPage();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Plan your homelab before you buy it.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/open-source visual planner for homelabs, LAN parties and game servers/),
    ).toBeInTheDocument();
  });

  it('answers every question on the page itself', async () => {
    await renderPage();

    for (const faq of FAQS) {
      expect(screen.getByRole('heading', { level: 3, name: faq.question })).toBeInTheDocument();
      expect(screen.getByText(faq.answer)).toBeInTheDocument();
    }
  });

  it('shows the address plan and the comparison as real tables', async () => {
    await renderPage();

    const addresses = screen.getByRole('table', { name: /address plan/i });
    expect(within(addresses).getByRole('rowheader', { name: 'Core Switch' })).toBeInTheDocument();
    expect(within(addresses).getByText('192.168.1.10')).toBeInTheDocument();

    const comparison = screen.getByRole('table', { name: /diagram tools, HLBuilder/i });
    expect(within(comparison).getByRole('columnheader', { name: 'HLBuilder' })).toBeInTheDocument();
    expect(
      within(comparison).getByRole('rowheader', { name: 'Discover devices on a running network' }),
    ).toBeInTheDocument();
  });

  it('offers sign-in, the star count and a way in without an account', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'GitHub, 280 stars' })).toHaveAttribute(
      'href',
      'https://github.com/Butterski/homelab-builder',
    );
    expect(screen.getByRole('link', { name: 'or host it yourself' })).toHaveAttribute(
      'href',
      '#self-host',
    );
  });

  it('takes the prerendered copy away once it is drawn', async () => {
    const copy = document.createElement('div');
    copy.id = 'prerender';
    document.body.append(copy);

    await renderPage();

    expect(document.getElementById('prerender')).toBeNull();
  });
});

describe('the page written into index.html', () => {
  it('carries the heading, the answers and the scroller, without the demo or the sign-in', () => {
    const page = prerender();

    expect(page.html).toContain('<h1>Plan your homelab before you buy it.</h1>');
    expect(page.html).toContain(LANDING_SCROLLER_ATTRIBUTE);
    expect(page.html).toContain('How are IP addresses assigned?');
    expect(page.html).toContain('192.168.1.150');
    expect(page.html).not.toContain('demo canvas');
    expect(page.html).not.toContain('Sign in with Google');
    expect(page.html).not.toContain('undefined');
    expect(page.structuredData.mainEntity).toHaveLength(FAQS.length);
  });
});
