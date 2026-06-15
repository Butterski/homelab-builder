import { apiUrl } from '../../../lib/api-base';

export type AuthConfig = {
  auth_disabled: boolean;
  google_client_id: string;
};

function isPlaceholderClientId(clientId: string): boolean {
  return !clientId || clientId === 'your-client-id' || clientId === 'your_client_id_here';
}

function buildTimeFallback(): AuthConfig {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  return {
    auth_disabled: isPlaceholderClientId(clientId),
    google_client_id: isPlaceholderClientId(clientId) ? '' : clientId,
  };
}

let authConfigPromise: Promise<AuthConfig> | null = null;

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
        };
      })
      .catch(() => buildTimeFallback());
  }

  return authConfigPromise;
}
