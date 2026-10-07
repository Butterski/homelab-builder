import { GoogleLoginButton } from '../../../components/auth/google-login-button';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { APP_VERSION_LABEL } from '../../../lib/version';
import { AsciiRack } from '../../landing/components/ascii-rack';
import '../../landing/landing.css';
import { peekAuthConfig } from '../lib/auth-config';

/**
 * What a visitor who is not signed in sees on somebody's own instance: who
 * runs here, the way in, and what this instance has switched on. The public
 * site shows the landing page instead (lib/site.ts decides).
 */
export default function WelcomePage() {
  const config = peekAuthConfig();
  const login = config && !config.auth_disabled;

  const instance = [
    { term: 'Version', value: APP_VERSION_LABEL.slice(1) },
    { term: 'Sign-in', value: login ? 'Google account' : 'None, local workspace' },
    { term: 'MCP server', value: config?.mcp_enabled ? 'On, at /mcp' : 'Off' },
    { term: 'Assistant', value: config?.assistant_enabled ? 'Available in Settings' : 'Off' },
  ];

  return (
    <div className="landing dark lp-welcome">
      <SeoMeta
        title="HLBuilder"
        description="A private HLBuilder instance. Sign in to open your projects."
        robots="noindex"
      />
      <main className="lp-welcome-body lp-wrap">
        <div className="lp-welcome-text">
          <p className="lp-brand">
            <img src="/logo.svg" alt="" width={24} height={24} />
            HLBuilder
          </p>
          <h1>Welcome to your HLBuilder.</h1>
          <p>
            Plan a homelab, a LAN party or a game server on a canvas. Addresses, hardware sizing
            and config files are worked out for you.
          </p>
          <div className="lp-signin">
            <GoogleLoginButton />
          </div>
          <dl className="lp-instance">
            {instance.map(item => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="lp-muted">
            <a className="lp-link" href="/docs/">
              Docs
            </a>{' '}
            and{' '}
            <a
              className="lp-link"
              href="https://github.com/Butterski/homelab-builder"
              target="_blank"
              rel="noopener noreferrer"
            >
              source on GitHub
            </a>
            .
          </p>
        </div>
        <div className="lp-rack-slot">
          <AsciiRack />
        </div>
      </main>
    </div>
  );
}
