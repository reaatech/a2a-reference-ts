# Authentication Guide

## Supported Strategies

### None (Development / Open Agents)
```ts
import { NoneStrategy } from '@reaatech/a2a-reference-auth';
const auth = new NoneStrategy();
```
Use `NoneStrategy` for local development or when the agent is intentionally public.

### API Key
```ts
import { ApiKeyStrategy } from '@reaatech/a2a-reference-auth';
const auth = new ApiKeyStrategy({ keys: new Set(['secret']) });
```
Validates the `x-api-key` header against a configured set of keys. Supports custom header names via `headerName` option.

### JWT (RS256)
```ts
import { JwtStrategy } from '@reaatech/a2a-reference-auth';
const auth = new JwtStrategy({ publicKey: '-----BEGIN PUBLIC KEY-----...' });
```
Validates Bearer tokens using a static RS256 public key. Supports `issuer` and `audience` verification.

### JWT with JWKS
```ts
const auth = new JwtStrategy({ jwksUri: 'https://auth.example.com/.well-known/jwks.json' });
```
Fetches verification keys dynamically from a JWKS endpoint. JWKS is cached for the lifetime of the strategy instance.

### OAuth2

```ts
import { OAuth2Strategy } from '@reaatech/a2a-reference-auth';

const auth = new OAuth2Strategy({
  issuer: 'https://auth.example.com',
  tokenEndpoint: 'https://auth.example.com/oauth/token',
  clientId: 'my-agent',
  clientSecret: 'secret',
  scopes: ['a2a:tasks'],
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
});
```

Full OAuth2 implementation supporting:

- **Token validation** — Verifies Bearer tokens against the configured issuer using JWKS or a static public key
- **Client credentials grant** — `exchangeClientCredentials()` for server-to-server auth
- **Authorization code grant** — `exchangeAuthorizationCode()` for user-facing flows with PKCE support
- **Token refresh** — `refreshAccessToken()` for long-lived sessions
- **Fetch timeout** — Configurable `fetchTimeoutMs` (default 10s) prevents hanging on unreachable providers

## Wiring into Server

```ts
import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
const app = createA2AExpressApp({ agentCard, executor, authStrategy: auth });
```

For Hono:
```ts
import { createA2AHonoApp } from '@reaatech/a2a-reference-server';
const app = createA2AHonoApp({ agentCard, executor, authStrategy: auth });
```

## Tenant Isolation

The `Task` schema includes `principal` and `tenantId` fields. When auth is enabled, tasks are automatically scoped to the authenticated principal. The `tasks/list` and `tasks/get` handlers filter results to only include tasks belonging to the current principal.
