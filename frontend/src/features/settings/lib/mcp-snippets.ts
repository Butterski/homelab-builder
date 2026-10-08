import { apiUrl } from '@/lib/api-base';

export const TOKEN_PLACEHOLDER = '<your-token>';

type McpSnippet = {
  id: string;
  label: string;
  /** Where the snippet goes or how it is used. */
  hint: string;
  code: string;
};

/**
 * The MCP endpoint of this instance. It sits next to the API, which in
 * development is a different origin than the page.
 */
export function mcpEndpointUrl(): string {
  return new URL(apiUrl('/mcp'), window.location.origin).href;
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Ready-to-paste client configuration for the common MCP clients. */
export function mcpSnippets(endpoint: string, token: string = TOKEN_PLACEHOLDER): McpSnippet[] {
  const bearer = `Bearer ${token}`;
  const url = new URL(endpoint);
  // mcp-remote refuses plain http to anything but localhost unless told otherwise.
  const bridgeArgs = ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${AUTH_HEADER}'];
  if (url.protocol === 'http:' && !isLocalhost(url.hostname)) bridgeArgs.push('--allow-http');

  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      hint: 'Run in a terminal.',
      code: `claude mcp add --transport http hlbuilder ${endpoint} --header "Authorization: ${bearer}"`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      hint: 'Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project).',
      code: JSON.stringify(
        { mcpServers: { hlbuilder: { url: endpoint, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      hint: 'Add to .vscode/mcp.json. VS Code asks for the token and keeps it out of the file.',
      code: JSON.stringify(
        {
          inputs: [
            {
              type: 'promptString',
              id: 'hlbuilder-token',
              description: 'HLBuilder access token',
              password: true,
            },
          ],
          servers: {
            hlbuilder: {
              type: 'http',
              url: endpoint,
              headers: { Authorization: 'Bearer ${input:hlbuilder-token}' },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      hint: 'Add to claude_desktop_config.json. Claude Desktop connects through the mcp-remote bridge, which needs Node.js.',
      code: JSON.stringify(
        {
          mcpServers: {
            hlbuilder: { command: 'npx', args: bridgeArgs, env: { AUTH_HEADER: bearer } },
          },
        },
        null,
        2,
      ),
    },
    {
      id: 'other',
      label: 'Other clients',
      hint: 'Any client that supports streamable HTTP with custom headers (LM Studio, Open WebUI, ...).',
      code: `URL:    ${endpoint}\nHeader: Authorization: ${bearer}`,
    },
  ];
}
