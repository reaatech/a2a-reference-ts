# @reaatech/a2a-reference-auth

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-auth.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Pluggable authentication strategies for A2A agents. Provides ready-to-use implementations for API key verification, JWT validation (including JWKS), and no-op pass-through — all behind a single `AuthStrategy` interface.

## Installation

```bash
npm install @reaatech/a2a-reference-auth
# or
pnpm add @reaatech/a2a-reference-auth
```

## Feature Overview

- **API key strategy** — validate against a whitelist of pre-shared keys
- **JWT strategy** — verify RS256 tokens against a static public key or remote JWKS endpoint
- **No-op strategy** — pass-through for development or gateway-authenticated setups
- **Single-method interface** — all strategies implement `authenticate(ctx): Promise<AuthResult>`
- **Zero cross-package dependencies** — self-contained, usable outside the A2A ecosystem

## Quick Start

```typescript
import { ApiKeyStrategy, JwtStrategy, NoneStrategy } from "@reaatech/a2a-reference-auth";

// API key verification
const apiKeyAuth = new ApiKeyStrategy({
  keys: new Set(["sk-abc123", "sk-def456"]),
});

// JWT with a static public key
const jwtAuth = new JwtStrategy({
  publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  issuer: "https://auth.example.com",
  audience: "a2a",
});

// JWT with remote JWKS (key rotation)
const jwksAuth = new JwtStrategy({
  jwksUri: "https://auth.example.com/.well-known/jwks.json",
  issuer: "https://auth.example.com",
});

// No-op (development or gateway auth)
const noAuth = new NoneStrategy();
```

## API Reference

### Core Interfaces

#### `AuthStrategy`

The contract that all strategies implement:

```typescript
interface AuthStrategy {
  authenticate(context: AuthContext): Promise<AuthResult>;
}
```

#### `AuthContext`

Input provided by the server framework:

```typescript
interface AuthContext {
  headers: Record<string, string | string[] | undefined>;
}
```

#### `AuthResult`

The result of an authentication attempt:

```typescript
interface AuthResult {
  authenticated: boolean;
  principal?: string; // Identity of the caller
  scopes?: string[];  // OAuth-style scope tokens
  reason?: string;    // Human-readable failure reason
}
```

### `ApiKeyStrategy`

Validates a pre-shared API key from a configurable request header.

```typescript
import { ApiKeyStrategy, type ApiKeyStrategyOptions } from "@reaatech/a2a-reference-auth";

const auth = new ApiKeyStrategy({
  keys: new Set(["secret-key-1", "secret-key-2"]),
  headerName: "x-api-key", // default
});
```

#### `ApiKeyStrategyOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `keys` | `Set<string>` | (required) | Whitelist of valid API keys |
| `headerName` | `string` | `"x-api-key"` | Header to check for the key |

#### Authentication Logic

- Missing header → `{ authenticated: false, reason: "missing api key" }`
- Key not in set → `{ authenticated: false, reason: "invalid api key" }`
- Valid key → `{ authenticated: true, principal: "api-key:<first8chars>..." }`

### `JwtStrategy`

Validates RS256-signed JWTs from the `Authorization: Bearer <token>` header.

```typescript
import { JwtStrategy, type JwtStrategyOptions } from "@reaatech/a2a-reference-auth";

// Static public key
const auth = new JwtStrategy({
  publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  issuer: "https://auth.example.com",
  audience: "my-app",
});

// Remote JWKS
const authWithJwks = new JwtStrategy({
  jwksUri: "https://auth.example.com/.well-known/jwks.json",
  issuer: "https://auth.example.com",
});
```

#### `JwtStrategyOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `publicKey` | `string` | — | SPKI PEM public key for RS256 verification |
| `jwksUri` | `string` | — | URL to a JWKS endpoint (supports key rotation via `kid`) |
| `issuer` | `string` | — | Expected `iss` claim |
| `audience` | `string` | — | Expected `aud` claim |

At least one of `publicKey` or `jwksUri` must be provided.

#### Authentication Logic

- Missing `Authorization` header → `{ authenticated: false, reason: "missing token" }`
- Malformed header → `{ authenticated: false, reason: "invalid format" }`
- No verification key configured → `{ authenticated: false, reason: "no verification key configured" }`
- Verification failure → `{ authenticated: false, reason: "verification failed: <error>" }`
- Success → `{ authenticated: true, principal: "<sub claim>", scopes: ["scope1", "scope2"] }`

The `sub` JWT claim is extracted as `principal`. The `scope` claim can be a space-delimited string or a string array.

### `NoneStrategy`

A no-op pass-through strategy that accepts all requests.

```typescript
import { NoneStrategy } from "@reaatech/a2a-reference-auth";

const auth = new NoneStrategy();
// Always returns: { authenticated: true, principal: "anonymous" }
```

Useful for:
- Local development
- When authentication is handled by an API gateway or reverse proxy
- Bootstrapping before adding real auth

## Integration with the Server

```typescript
import { createA2AExpressApp } from "@reaatech/a2a-reference-server";
import { ApiKeyStrategy } from "@reaatech/a2a-reference-auth";

const authStrategy = new ApiKeyStrategy({
  keys: new Set([process.env.A2A_API_KEY]),
});

const app = createA2AExpressApp({
  agentCard,
  executor,
  authStrategy, // <-- plug in here
});

app.listen(3000);
```

The server framework calls `authenticate()` on every request. Authenticated tasks have their `principal` field set to the caller's identity, enabling per-user task isolation in `tasks/list` and `tasks/get`.

## Creating a Custom Strategy

Implement the `AuthStrategy` interface:

```typescript
import type { AuthStrategy, AuthContext, AuthResult } from "@reaatech/a2a-reference-auth";

class MyCustomAuth implements AuthStrategy {
  async authenticate(context: AuthContext): Promise<AuthResult> {
    const token = context.headers["x-custom-token"];

    if (!token) {
      return { authenticated: false, reason: "missing custom token" };
    }

    const valid = await this.validateToken(token);
    if (!valid) {
      return { authenticated: false, reason: "invalid custom token" };
    }

    return { authenticated: true, principal: token };
  }

  private async validateToken(token: string): Promise<boolean> {
    // Your validation logic here
    return true;
  }
}
```

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
