# AI assistant: how your key and your data are handled

The assistant in the builder is off until you turn it on in **Settings → AI assistant**. It has no
model and no key of its own: you choose a provider and enter your own API key, and every request is
billed to your account with that provider.

This page explains what happens to the key and to your build data, what the protection does not
cover, and where to read the code. Nothing here asks you to take it on trust; each claim links to
the file that implements it.

## Why the key is stored on the server

The alternative is to keep the key in your browser and call the provider from there. HLBuilder does
not do that, for three reasons.

- **The assistant's tools run on the server.** Reading a build, searching the catalog and preparing a
  proposal are the same code paths MCP clients use, with the same ownership checks. Calling the model
  next to them keeps one path to secure and to review.
- **A key in the browser is readable by any script on the page.** One cross-site scripting bug, or
  one browser extension, and the key is gone. A key the server never sends back cannot leak that way.
- **It works with every provider.** Several providers refuse calls made directly from a browser.

The cost of this choice is that the server must be able to decrypt the key to use it. See
[What this does not protect against](#what-this-does-not-protect-against).

## What happens to the key

1. You submit the key over HTTPS to `PUT /api/assistant/settings`.
2. The server encrypts it with **AES-256-GCM** and a fresh random 96-bit nonce, and stores the
   ciphertext, the nonce and the master key version in the `assistant_settings` table.
   Code: [`backend/internal/secrets/aesgcm.go`](../backend/internal/secrets/aesgcm.go).
3. The encryption is bound to your account. Your account id goes into the additional authenticated
   data (`hlb:assistant-key:v1|user:<your id>`), so a ciphertext copied into another account's row
   fails authentication instead of decrypting.
   Code: `keyAAD` in [`backend/internal/services/assistant_settings_service.go`](../backend/internal/services/assistant_settings_service.go).
4. The key is never returned. No API response contains it. The settings page receives only the last
   four characters (and nothing at all for keys shorter than 12 characters).
5. When you send a chat message, the key is decrypted in memory for that request, passed to the
   provider's client, and dropped when the request ends. It is not written to logs. SQL statements
   are logged with placeholders only, so values such as chat text or ciphertext never appear in the
   SQL log ([`backend/pkg/database/database.go`](../backend/pkg/database/database.go)).
6. Changing the provider or the endpoint address **deletes the stored key** unless you enter a new
   one in the same request. A key is never sent to an address other than the one it was entered for.
7. **Delete stored key** in Settings removes the ciphertext immediately.

The settings page shows the stored record itself: algorithm, nonce, ciphertext size, the first bytes
of the ciphertext and its SHA-256 prefix, what it is bound to, and when it was stored and last used.
You can compare it with the database:

```sql
SELECT encode(key_nonce, 'hex'), length(key_ciphertext), key_version, key_hint
FROM assistant_settings WHERE user_id = '<your id>';
```

## The master key

Stored keys are encrypted with a master key that belongs to the instance.

| Source | When | What it protects |
|---|---|---|
| `SECRETS_KEY` environment variable | Required on a public instance (login enabled, release mode). | The master key is not in the database. A database dump or backup alone cannot decrypt stored keys. |
| Generated and kept in the database | A self-hosted instance without `SECRETS_KEY`. | A leak of the settings table alone. **Not** a copy of the whole database, because the master key is in it. |

The settings page states which one the instance uses. To move a self-hosted instance to the stronger
setup, generate a key and restart:

```bash
openssl rand -base64 32
```

Put the output in `SECRETS_KEY`. Keys stored under the previous master key can no longer be read and
have to be entered again; the settings page says so. A public instance started without `SECRETS_KEY`
does not start the assistant at all (the log says why) rather than fall back to the weaker setup.
Code: `LoadKeyring` in [`assistant_settings_service.go`](../backend/internal/services/assistant_settings_service.go).

## What this does not protect against

- **The operator of the instance.** The server decrypts the key to use it, so whoever runs the server
  could do the same. If you do not run the instance yourself, use a key with a spending limit, or
  self-host.
- **A fully compromised server.** An attacker who can run code on the server while you chat can read
  the key from memory.
- **Your provider account.** HLBuilder cannot limit what the provider bills. Set a budget there.

## What is sent to the provider

Each chat request sends:

- the conversation so far and your new message;
- the device you have selected on the canvas, if any. A chip above the message box names it and
  lets you leave it out. The browser sends only its id; the server keeps it if it belongs to the
  open build and describes the device from its own data (name, type, id);
- a fixed instruction text, the same for every user
  ([`backend/internal/assistant/instructions.go`](../backend/internal/assistant/instructions.go));
- the results of the tools the model calls. In practice that is the build you have open (device
  names, types and specs, IP addresses, connections, VMs and services), catalog entries it searches
  for, and the configs it generates for that build. For a LAN party or game server build this
  includes the game plan: your line speed, the power circuits, and the address your friends
  connect to if you entered one.

It does not send your email, your login, your access tokens, or other builds. The chat is confined to
the build that is open: the same check that confines a single-build MCP token.
Code: [`backend/internal/assistant/agent.go`](../backend/internal/assistant/agent.go),
[`backend/internal/assistant/tools.go`](../backend/internal/assistant/tools.go).

The provider's own data policy applies to what it receives. With Anthropic's Claude Opus 5 and Fable
models, HLBuilder asks Anthropic to answer a request the model declines with another Claude model
(server-side fallback), so a chat does not stop midway. The request still goes only to Anthropic.
Code: [`backend/internal/llm/anthropic.go`](../backend/internal/llm/anthropic.go).

The conversation is stored in the instance's database so it is there when you reopen the build.
That includes a reply you stopped or one cut off by an error, as far as it was written and marked
as unfinished, so what you saw is also what the model is told next time. With each step the
assistant took, a one-line summary and its duration are stored. **Clear the chat** in the panel
deletes all of it.

## The assistant cannot change a build

The model has no tool that writes to a build. It can only create a **proposal**: a change set that is
checked with a dry run and then waits for you. You see it on the canvas, drawn as the build would
be with every change marked and listed. The canvas is read-only while you look: the browser keeps
the proposal apart from your build, so nothing of it can be saved along with your own edits. Only
your **Apply** saves it, and one `Ctrl+Z` undoes an applied proposal.
Code: [`backend/internal/services/proposal_service.go`](../backend/internal/services/proposal_service.go),
`proposalPreview` in [`frontend/src/features/builder/store/builder-store.ts`](../frontend/src/features/builder/store/builder-store.ts).

Text inside a build (device names, notes) reaches the model as data. A reply is rendered as Markdown
without raw HTML and without images, so a reply cannot make your browser load an address of the
model's choosing.
Code: [`frontend/src/features/assistant/components/message-markdown.tsx`](../frontend/src/features/assistant/components/message-markdown.tsx).

The chat also lists the steps the assistant takes, each with what it was about and what came of it
("Search the hardware catalog", "2.5G switch", "6 results"). Those short texts are built from what
the model wrote, so they are treated like the reply: the server cuts each to one line of at most 80
characters without control characters, and the browser shows them as plain text, never as Markdown.
Code: `brief` in [`backend/internal/assistant/tools.go`](../backend/internal/assistant/tools.go),
[`frontend/src/features/assistant/components/activity-timeline.tsx`](../frontend/src/features/assistant/components/activity-timeline.tsx).

## Which addresses the server will call

With **Ollama** or **Other OpenAI-compatible endpoint** you choose the address the server calls. On a
shared instance that must not become a way to reach the server's own network.

- On a public instance the address must be `https`, must not contain credentials or a query string,
  and must not resolve to a loopback, private, link-local (including the cloud metadata address
  `169.254.169.254`), carrier-grade NAT, unique-local or otherwise reserved address.
- The check runs on the address the connection is actually made to, after DNS resolution and on
  every connection, so a hostname that is re-pointed to an internal address is refused too. Proxy
  environment variables are ignored.
- A self-hosted instance without login allows private addresses, because that is how a model on
  your own network is reached. `ASSISTANT_ALLOW_PRIVATE_ENDPOINTS` overrides the default either way.

Code: [`backend/internal/llm/ssrf.go`](../backend/internal/llm/ssrf.go).

## Limits

- One reply at a time per account, at most 12 model calls per message, and a 5 minute limit per turn.
- A message can be 8,000 characters. A conversation that grows past 160 stored messages has to be
  cleared; it is never trimmed silently.
- Only the assistant's own tools are available to the model. `create_build` is not among them.

## Audit log

These actions are recorded in the instance's `events` table with your account id, without key
material and without chat text:

| Event | When |
|---|---|
| `assistant.key_stored` | A provider key was stored (records the provider name). |
| `assistant.key_deleted` | A stored key was removed, by you or because the provider or endpoint changed. |
| `assistant.tool_call` | The assistant called a state-changing tool (`propose_changes`). |
| `proposal.created`, `proposal.applied`, `proposal.rejected`, `proposal.conflict` | The life of a proposal. |

## Operating it

| Variable | Default | Purpose |
|---|---|---|
| `ASSISTANT_ENABLED` | `true` | Set to `false` to remove the assistant for everyone. |
| `SECRETS_KEY` | none | Base64 of 32 random bytes; the master key. Required on a public instance. |
| `SECRETS_KEY_VERSION` | `1` | Version label stored with each ciphertext. |
| `ASSISTANT_ALLOW_PRIVATE_ENDPOINTS` | `true` without login, otherwise `false` | Whether custom endpoints may be private addresses. |

Behind your own reverse proxy, forward `/api/assistant/` unbuffered so replies stream, as
[`frontend/nginx.conf`](../frontend/nginx.conf) does.

## Verify it yourself

| What | Where |
|---|---|
| Encryption and decryption | [`backend/internal/secrets/aesgcm.go`](../backend/internal/secrets/aesgcm.go), tests in [`aesgcm_test.go`](../backend/internal/secrets/aesgcm_test.go) |
| Storing, wiping and resolving the key | [`backend/internal/services/assistant_settings_service.go`](../backend/internal/services/assistant_settings_service.go), tests in [`assistant_settings_service_test.go`](../backend/internal/services/assistant_settings_service_test.go) |
| The key is never serialised | `json:"-"` on the key fields of `AssistantSettings` in [`backend/internal/models/models.go`](../backend/internal/models/models.go) |
| Where the key is used | [`backend/internal/llm/anthropic.go`](../backend/internal/llm/anthropic.go), [`backend/internal/llm/openai_compat.go`](../backend/internal/llm/openai_compat.go) |
| Address checks | [`backend/internal/llm/ssrf.go`](../backend/internal/llm/ssrf.go), tests in [`ssrf_test.go`](../backend/internal/llm/ssrf_test.go) |
| The chat loop and its limits | [`backend/internal/assistant/agent.go`](../backend/internal/assistant/agent.go) |
| What a selection on the canvas adds to a request | `selectedNodes` in [`agent.go`](../backend/internal/assistant/agent.go), tests in [`agent_test.go`](../backend/internal/assistant/agent_test.go) |
| Step texts are short plain lines | `brief` in [`backend/internal/assistant/tools.go`](../backend/internal/assistant/tools.go), tests in [`agent_test.go`](../backend/internal/assistant/agent_test.go) |
| HTTP endpoints | [`backend/internal/handlers/assistant_handler.go`](../backend/internal/handlers/assistant_handler.go) |
| MCP access tokens | [`docs/MCP.md`](MCP.md) |
