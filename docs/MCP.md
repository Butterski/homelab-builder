# Connecting LLM clients over MCP

HLBuilder has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server. An MCP
client such as Claude Code, Cursor or VS Code can read your builds, search the hardware and service
catalogs, and propose changes to a build. You approve every change in the builder.

It works the same on a self-hosted instance and on the hosted one. The endpoint is `/mcp` on the
address you open HLBuilder at, for example `http://192.168.1.50:3000/mcp` or `https://hlbldr.com/mcp`.

## 1. Create an access token

Open **Settings → MCP access** and choose **Create token**.

| Option | Meaning |
|---|---|
| Access: read only | The client can read builds, validate them, generate configs and search the catalogs. |
| Access: read and propose | The client can also send proposals and create empty builds. |
| Builds | "All my builds", or one build the token is confined to. |
| Expires | 30 days, 90 days, 1 year, or no expiry. |

The token starts with `hlb_` and is shown once. HLBuilder stores only a SHA-256 hash of it, so it
cannot be shown again; create a new token if you lose it. Give each client its own token so you can
revoke them one by one. An account can hold 20 tokens.

A token is always required, including on a self-hosted instance that runs without login.

## 2. Add the server to your client

Replace the URL and token with your own. The Settings page shows these snippets filled in.

**Claude Code**

```bash
claude mcp add --transport http hlbuilder https://hlbldr.com/mcp --header "Authorization: Bearer hlb_..."
```

**Cursor** (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "hlbuilder": {
      "url": "https://hlbldr.com/mcp",
      "headers": { "Authorization": "Bearer hlb_..." }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`). VS Code asks for the token and keeps it out of the file.

```json
{
  "inputs": [
    { "type": "promptString", "id": "hlbuilder-token", "description": "HLBuilder access token", "password": true }
  ],
  "servers": {
    "hlbuilder": {
      "type": "http",
      "url": "https://hlbldr.com/mcp",
      "headers": { "Authorization": "Bearer ${input:hlbuilder-token}" }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`). Claude Desktop has no setting for a request
header, so it connects through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge,
which needs Node.js. Add `"--allow-http"` to `args` for a plain-http address on your LAN.

```json
{
  "mcpServers": {
    "hlbuilder": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://hlbldr.com/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer hlb_..." }
    }
  }
}
```

**Other clients** (LM Studio, Open WebUI, ...): any client that supports streamable HTTP with a
custom header works. Use the URL and the header `Authorization: Bearer hlb_...`.

The connectors in the claude.ai and ChatGPT web apps require OAuth and cannot use a token.

## 3. How proposals work

An LLM client never edits a build directly.

1. The client calls `propose_changes` with a list of operations (add a node, connect two nodes, add
   a service, ...). HLBuilder checks the change set with a dry run and returns what would change,
   the IP addresses the devices would get, and any network warnings. An invalid change set is
   refused with a message naming the faulty operation, and nothing is stored.
2. The proposal waits in the builder. If the build is open, a banner appears within a few seconds;
   the client also gets a review link. Elsewhere in the app, the project's card in the sidebar
   shows that a proposal is waiting. A banner you put aside leaves a small chip to come back to.
3. **Review** shows the proposal on the canvas itself, drawn as the build would be: what is removed
   fades, what changes is marked, and new devices and cables come in one after another. The canvas
   is read-only while you look, and nothing is saved. A bar under the canvas steps through the
   changes; the side panel lists every one of them.
4. **Apply** saves the changes. They are applied on top of your latest edits, the canvas shows what
   was applied, and `Ctrl+Z` undoes them in one step. A new device is put where there is room on
   the canvas as it is when you apply, not where the client saw free space; **Polish** arranges
   everything if you want it in line. **Reject** discards the proposal; the reason you give is
   passed to the client.

A new proposal for a build replaces the one still waiting. If you change the build so that a
proposal no longer fits (for example you delete a device it connects to), it is marked as a
conflict and cannot be applied.

## Tools

| Tool | Access | What it does |
|---|---|---|
| `list_builds` | read | Lists the builds the token can reach, with their kind (homelab, LAN party, game server). |
| `get_build` | read | Nodes, connections, services, free ports, addresses and proposal status of a build. For a LAN party or game server also the game plan. |
| `validate_build` | read | Network errors and warnings from the IP address manager. |
| `generate_configs` | read | Starter docker-compose, `.env`, Ansible inventory and Nginx config. |
| `gaming_report` | read | Checks a build as a game server or LAN party plan: sizing, port forwards, upload, DHCP pool, switch ports, power circuits. |
| `search_hardware` | read | Searches the hardware catalog. |
| `list_services` | read | Lists self-hosted services and their resource needs. Game servers are in the `gaming` category. |
| `recommend_hardware` | read | Sizes hardware for a set of services. |
| `get_proposal` | read | Whether a proposal is pending, applied, rejected, replaced or in conflict. |
| `propose_changes` | propose | Stages a change set for you to approve. |
| `create_build` | propose | Creates an empty build, as a homelab, a LAN party or a game server plan. Not available to a token confined to one build. |

### Gaming builds

A client can plan a LAN party or a game server the same way it plans a homelab
(see [GAMING.md](GAMING.md)):

- `add_vm` with a game from the `gaming` category creates a game server. `players`, `exposure`
  (`lan`, `port_forward`, `vpn`, `relay`) and `port_offset` can be set on `add_vm` and `update_vm`;
  the player count sizes memory and cores unless the client sets them.
- `add_node` accepts the types `lan_table` and `console`. A table takes `seats` in its details.
- The `set_plan` operation changes the kind of the build and the game plan: the internet line,
  the power circuits and the event. It names only the settings to change; the rest stay as they are.
- The answer to `propose_changes` includes what the gaming report would say once the proposal is
  applied, so the client can correct a plan before you review it.

The game plan holds the address your friends connect to. A client with a token for that build can
read it, like the rest of the build.

## Limits and safety

- Every request is checked against the token's owner: a client only ever sees that account's
  builds. A confined token sees one build.
- Per token: 120 requests a minute, and 20 proposals a minute. Repeated requests with a bad token
  from one address are slowed down.
- Requests from a browser page on another origin are refused. To allow a browser-based client, set
  `MCP_ALLOWED_ORIGINS` to a comma-separated list of origins.
- State-changing calls (`propose_changes`, `create_build`) are written to the audit log, without
  their arguments.
- Names and notes stored in a build are passed to the client as data. A build you share with an
  edit link can be changed by other people, so treat its text as untrusted, as the client is told to.

## Operating it

| Variable | Default | Purpose |
|---|---|---|
| `MCP_ENABLED` | `true` | Set to `false` to remove the `/mcp` endpoint. |
| `MCP_ALLOWED_ORIGINS` | empty | Browser origins allowed to call `/mcp` cross-origin. |
| `PUBLIC_APP_URL` | derived from the request | Address used in review links, e.g. `https://lab.example.com`. |

Behind your own reverse proxy, forward `/mcp` to the backend unbuffered, as
[`frontend/nginx.conf`](../frontend/nginx.conf) does.

## The in-app assistant

The chat panel in the builder (Settings → AI assistant) uses the same tools and the same proposal
flow, with your own provider key instead of an MCP client. How that key is stored is described in
[AI-ASSISTANT-SECURITY.md](AI-ASSISTANT-SECURITY.md).

## Where the code is

- Endpoint, token check and rate limits: [`backend/internal/mcpserver/server.go`](../backend/internal/mcpserver/server.go)
- Tools: [`backend/internal/assistant/`](../backend/internal/assistant/)
- Token storage: [`backend/internal/services/api_token_service.go`](../backend/internal/services/api_token_service.go)
- Proposals: [`backend/internal/services/proposal_service.go`](../backend/internal/services/proposal_service.go)
- Change-set rules: [`backend/internal/services/topology_ops.go`](../backend/internal/services/topology_ops.go)
