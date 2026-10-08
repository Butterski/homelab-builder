/**
 * Links into the public source code, so anyone can check how HLBuilder handles
 * tokens and keys instead of taking the settings page at its word. HEAD resolves
 * to the repository's default branch.
 */
const SOURCE_REPO_URL = 'https://github.com/Butterski/homelab-builder';

export function sourceUrl(path: string): string {
  return `${SOURCE_REPO_URL}/blob/HEAD/${path}`;
}

/** Repository paths the settings page links to. A test checks that each exists. */
export const SOURCE_PATHS = {
  // MCP access
  mcpServer: 'backend/internal/mcpserver/server.go',
  tokenService: 'backend/internal/services/api_token_service.go',
  proposalService: 'backend/internal/services/proposal_service.go',
  mcpDocs: 'docs/MCP.md',
  // AI assistant key handling
  keyEncryption: 'backend/internal/secrets/aesgcm.go',
  keyStorage: 'backend/internal/services/assistant_settings_service.go',
  keyStorageTests: 'backend/internal/services/assistant_settings_service_test.go',
  anthropicClient: 'backend/internal/llm/anthropic.go',
  openAIClient: 'backend/internal/llm/openai_compat.go',
  endpointGuard: 'backend/internal/llm/ssrf.go',
  chatAgent: 'backend/internal/assistant/agent.go',
  assistantSecurityDocs: 'docs/AI-ASSISTANT-SECURITY.md',
} as const;
