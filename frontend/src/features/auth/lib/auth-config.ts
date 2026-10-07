import { apiUrl } from '../../../lib/api-base';

export type AuthConfig = {
  auth_disabled: boolean;
  google_client_id: string;
  /** Whether this instance exposes the /mcp endpoint for LLM clients. */
  mcp_enabled: boolean;
  /** Whether this instance offers the in-app bring-your-own-key assistant. */
  assistant_enabled: boolean;
};

function isPlaceholderClientId(clientId: string): boolean {
  return !clientId || clientId === 'your-client-id' || clientId === 'your_client_id_here';
}

function buildTimeFallback(): AuthConfig {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  return {
    auth_disabled: isPlaceholderClientId(clientId),
    google_client_id: isPlaceholderClientId(clientId) ? '' : clientId,
    mcp_enabled: false,
    assistant_enabled: false,
  };
}

let authConfigPromise: Promise<AuthConfig> | null = null;
let resolvedAuthConfig: AuthConfig | null = null;

/** The auth config if it has arrived already; never waits. */
export function peekAuthConfig(): AuthConfig | null {
  return resolvedAuthConfig;
}

export function getAuthConfig(): Promise<AuthConfig> {
  if (!authConfigPromise) {
    authConfigPromise = fetch(apiUrl('/auth/config'))
      .then(async response => {
        if (!response.ok) {
          throw new Error(`auth config failed with ${response.status}`);
        }
        const config = await response.json() as AuthConfig;
        const clientId = config.google_client_id || '';
        return {
          auth_disabled: config.auth_disabled || isPlaceholderClientId(clientId),
          google_client_id: isPlaceholderClientId(clientId) ? '' : clientId,
          mcp_enabled: config.mcp_enabled === true,
          assistant_enabled: config.assistant_enabled === true,
        };
      })
      .catch(() => buildTimeFallback())
      .then(config => {
        resolvedAuthConfig = config;
        return config;
      });
  }

  return authConfigPromise;
}
