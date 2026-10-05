/// <reference types="node" />
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpEndpointUrl, mcpSnippets, TOKEN_PLACEHOLDER } from './mcp-snippets';
import { SOURCE_PATHS, sourceUrl } from './source-links';

const TOKEN = 'hlb_' + 'A'.repeat(43);

describe('mcpSnippets', () => {
  it('puts the endpoint and the token into every client configuration', () => {
    const endpoint = 'https://hlbldr.com/mcp';
    const snippets = mcpSnippets(endpoint, TOKEN);

    expect(snippets.map(snippet => snippet.id)).toEqual([
      'claude-code',
      'cursor',
      'vscode',
      'claude-desktop',
      'other',
    ]);
    for (const snippet of snippets) {
      expect(snippet.code).toContain(endpoint);
    }

    const byId = Object.fromEntries(snippets.map(snippet => [snippet.id, snippet.code]));
    expect(byId['claude-code']).toBe(
      `claude mcp add --transport http hlbuilder ${endpoint} --header "Authorization: Bearer ${TOKEN}"`,
    );
    expect(JSON.parse(byId.cursor).mcpServers.hlbuilder).toEqual({
      url: endpoint,
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    // VS Code prompts for the token instead of storing it in the workspace file.
    const vscode = JSON.parse(byId.vscode);
    expect(byId.vscode).not.toContain(TOKEN);
    expect(vscode.servers.hlbuilder).toMatchObject({ type: 'http', url: endpoint });
    expect(vscode.inputs[0]).toMatchObject({ id: 'hlbuilder-token', password: true });

    // Claude Desktop has no header setting, so it goes through the mcp-remote bridge.
    const desktop = JSON.parse(byId['claude-desktop']).mcpServers.hlbuilder;
    expect(desktop.command).toBe('npx');
    expect(desktop.args).toEqual(['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${AUTH_HEADER}']);
    expect(desktop.env.AUTH_HEADER).toBe(`Bearer ${TOKEN}`);
  });

  it('uses a placeholder when no token is at hand', () => {
    const snippets = mcpSnippets('https://hlbldr.com/mcp');
    expect(snippets[0].code).toContain(TOKEN_PLACEHOLDER);
  });

  it('lets the bridge use plain http only for self-hosted LAN addresses', () => {
    const args = (endpoint: string) =>
      JSON.parse(mcpSnippets(endpoint, TOKEN).find(snippet => snippet.id === 'claude-desktop')!.code)
        .mcpServers.hlbuilder.args as string[];

    expect(args('http://192.168.1.50:3000/mcp')).toContain('--allow-http');
    expect(args('http://localhost:8080/mcp')).not.toContain('--allow-http');
    expect(args('https://hlbldr.com/mcp')).not.toContain('--allow-http');
  });

  it('derives the endpoint from where the API lives', () => {
    expect(mcpEndpointUrl()).toMatch(/^https?:\/\/[^/]+\/mcp$/);
  });
});

describe('source links', () => {
  // The settings page tells people to verify our claims in the source. A link
  // to a file that was moved or renamed would quietly break that promise.
  const repoRoot = resolve(__dirname, '../../../../..');

  it.each(Object.entries(SOURCE_PATHS))('%s points at a file in the repository', (_name, path) => {
    expect(existsSync(resolve(repoRoot, path)), `${path} does not exist`).toBe(true);
    expect(sourceUrl(path)).toBe(`https://github.com/Butterski/homelab-builder/blob/HEAD/${path}`);
  });
});
