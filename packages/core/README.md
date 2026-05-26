# @reaatech/a2a-reference-core

Canonical A2A protocol types, Zod schemas, error classes, and signature verification.

## Usage

```ts
import {
  TaskSchema, AgentCardSchema, MessageSchema, PartSchema,
  TaskNotFoundError, verifyAgentCardSignatures,
  AgentCardSignatureSchema, MutualTlsSecuritySchemeSchema,
} from '@reaatech/a2a-reference-core';
```

## Included Schemas

- **Parts** — `TextPart`, `FilePart`, `DataPart` with union `Part`
- **Messages** — `Message` with role, parts, metadata, and reference task IDs
- **Task** — Full task lifecycle with `TaskState` (8 states), artifacts, history
- **Agent Card** — Discovery metadata, capabilities, skills, security schemes
- **Security Schemes** — API key, HTTP Bearer, OAuth2, OpenID Connect, **mutual TLS**
- **Signatures** — `AgentCardSignature` with RSA/ECDSA/Ed25519 verification
- **Requests** — `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, `GetExtendedAgentCard`, `TaskPushNotificationConfig`
- **Events** — `TaskStatusUpdateEvent`, `TaskArtifactUpdateEvent`, `StreamResponse`

## Error Classes

All errors extend `A2AError` with typed error codes:

- `TaskNotFoundError`, `TaskNotCancelableError`
- `PushNotificationNotSupportedError`, `UnsupportedOperationError`
- `ContentTypeNotSupportedError`, `InvalidAgentResponseError`
- `ExtendedAgentCardNotConfiguredError`, `ExtensionSupportRequiredError`
- `VersionNotSupportedError`

## Signature Verification

```ts
import { verifyAgentCardSignatures, type AgentCardSignature } from '@reaatech/a2a-reference-core';

const result = await verifyAgentCardSignatures(agentCard, signatures);
if (!result.valid) {
  console.error('Invalid signatures:', result.errors);
}
```

Supports RS256, RS384, RS512, ES256, ES384, ES512, and Ed25519 algorithms with JWK URL fetching.
