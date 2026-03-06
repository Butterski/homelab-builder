# Security Policy

## Supported Versions

Currently only the `master` version of HLBuilder is actively supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| v1.0.x  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within HLBuilder, please do NOT post it on the public GitHub issue tracker. 

Instead, please send an e-mail to the repository owner directly or use GitHub's private vulnerability reporting feature on this repository. We will attempt to address and resolve the vulnerability as quickly as possible.

Common vulnerabilities include:
- SQL Injections
- Authentication/Authorization bypasses
- Cross-Site Scripting (XSS)
- Exposure of sensitive backend environment variables or secrets

We appreciate your effort in responsibly disclosing vulnerabilities to keep the homelab community safe!

## Authentication Modes & Security Implications

HLBuilder supports two authentication modes. Choosing the wrong mode for your deployment scenario is a security risk — please read this section carefully.

### 1. Google OAuth Mode (Production / Public Deployments)

This is the default mode when `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` are configured. Users must authenticate via Google OAuth 2.0 and receive a signed JWT.

**Requirements:**
- `GOOGLE_CLIENT_ID` — must be set to a valid Google OAuth 2.0 client ID.
- `VITE_GOOGLE_CLIENT_ID` — must be set at frontend build time to the same client ID.
- `JWT_SECRET` — **must** be set to a strong, unique, random value (minimum 32 characters recommended). The backend **refuses to start** in release mode (`GIN_MODE=release`) if `JWT_SECRET` is missing, empty, or set to the default dev value.
- `GIN_MODE=release` — enforces the JWT secret strength check and disables the dev login endpoint.

**Checklist for production:**
- [ ] Set `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` to your OAuth client ID
- [ ] Set `JWT_SECRET` to a cryptographically random string (e.g., `openssl rand -base64 48`)
- [ ] Set `GIN_MODE=release`
- [ ] Ensure the frontend is served over HTTPS (via reverse proxy)
- [ ] Verify the `/auth/dev` endpoint returns 404 (it is disabled in release mode)

### 2. Auth-Disabled Mode (Local / Self-Hosted Deployments)

When `GOOGLE_CLIENT_ID` is **not set** (empty or absent), the backend automatically enters **auth-disabled mode**:

- All protected endpoints bypass JWT validation entirely.
- A **Local Admin** user (`local@homelab.local`) is auto-provisioned and used for every request.
- No login credentials are required — anyone with network access to the application has full admin access.

> :warning: **Auth-disabled mode is inherently insecure.** It is designed exclusively for local, trusted-network deployments (e.g., running on `localhost` or behind a VPN). **Never expose an auth-disabled instance to the public internet.**

**If you need remote access with auth disabled, protect the instance with:**
- A VPN (e.g., WireGuard, Tailscale)
- A reverse proxy with HTTP Basic Auth or mTLS (e.g., Nginx, Caddy, Traefik)
- Firewall rules restricting access to trusted IPs

### Dev Login Endpoint

When `GIN_MODE` is **not** set to `release`, the backend exposes a development login endpoint:

```
POST /auth/dev
Content-Type: application/json

{ "email": "any-email@example.com" }
```

This endpoint creates or logs into a user account with the given email — **no password, no OAuth token, no verification**. It returns a valid JWT.

> :warning: **The dev login endpoint is a deliberate backdoor for development convenience.** It is automatically disabled when `GIN_MODE=release`. Always verify it is not accessible on any internet-facing deployment by setting `GIN_MODE=release`.

## Security Architecture

### JWT Handling

- JWTs are signed with HMAC-SHA256 using the `JWT_SECRET`.
- Token claims include `user_id`, `email`, and standard registered claims (expiry, issuer).
- The backend validates tokens on every protected request via the `AuthMiddleware`.
- In release mode, the backend **panics on startup** if `JWT_SECRET` is weak or default — this is an intentional fail-safe.

### Rate Limiting

- The `/auth/google` login endpoint is protected by per-IP rate limiting.
- After repeated failed login attempts, the IP is temporarily locked out.
- Rate limiting uses `c.ClientIP()` with trusted proxy configuration to prevent IP spoofing via `X-Forwarded-For`.

### Trusted Proxies

The backend explicitly configures trusted proxy ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) to ensure `c.ClientIP()` only trusts `X-Forwarded-For` headers from internal Docker/reverse-proxy networks.

### Security Headers

All responses include standard security headers via the `SecurityHeaders()` middleware (e.g., `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`).

### CORS

- In release mode (`GIN_MODE=release`): CORS `Access-Control-Allow-Origin` is locked to `https://hlbldr.com`.
- In debug mode: CORS allows `*` for local development convenience.

### Database

- All primary keys use PostgreSQL-native UUID v4 generation — IDs are non-sequential and non-guessable.
- The database is not exposed externally in the default Docker Compose configuration (no host port mapping for the `postgres` service).

