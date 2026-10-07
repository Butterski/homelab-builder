import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../lib/auth-config';
import WelcomePage from './welcome-page';

const config = vi.hoisted(() => ({ current: null as AuthConfig | null }));

vi.mock('../lib/auth-config', () => ({
  peekAuthConfig: () => config.current,
}));

vi.mock('../../../components/auth/google-login-button', () => ({
  GoogleLoginButton: () => <button type="button">Sign in</button>,
}));

// The rack draws itself; this screen only has to hold it.
vi.mock('../../landing/components/ascii-rack', () => ({
  AsciiRack: () => <div>rack</div>,
}));

describe('WelcomePage', () => {
  afterEach(() => {
    config.current = null;
    document.head.querySelector('meta[name="robots"]')?.remove();
  });

  it('offers the way in and nothing about the product as a service', () => {
    config.current = {
      auth_disabled: false,
      google_client_id: 'id',
      mcp_enabled: true,
      assistant_enabled: false,
    };
    render(<WelcomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to your HLBuilder.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/host it yourself/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Free and open source/i)).not.toBeInTheDocument();
  });

  it('says what this instance has switched on', () => {
    config.current = {
      auth_disabled: false,
      google_client_id: 'id',
      mcp_enabled: true,
      assistant_enabled: false,
    };
    render(<WelcomePage />);

    expect(screen.getByText('Google account')).toBeInTheDocument();
    expect(screen.getByText('On, at /mcp')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('names a local workspace when the instance runs without login', () => {
    config.current = {
      auth_disabled: true,
      google_client_id: '',
      mcp_enabled: false,
      assistant_enabled: true,
    };
    render(<WelcomePage />);

    expect(screen.getByText('None, local workspace')).toBeInTheDocument();
    expect(screen.getByText('Available in Settings')).toBeInTheDocument();
  });

  it('keeps a private instance out of search results', () => {
    render(<WelcomePage />);

    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });
});
