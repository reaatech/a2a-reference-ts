# @reaatech/a2a-reference-core

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-core.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Canonical TypeScript types, Zod schemas, and error classes for the [Agent-to-Agent (A2A) protocol](https://github.com/google/A2A). This package is the single source of truth for all A2A protocol shapes used throughout the `@reaatech/a2a-reference-*` ecosystem.

## Installation

```bash
npm install @reaatech/a2a-reference-core
# or
pnpm add @reaatech/a2a-reference-core
```

## Feature Overview

- **70+ exported types and schemas** — every A2A protocol shape has a corresponding Zod schema for runtime validation
- **35 Zod schemas** — parse and validate agent cards, tasks, messages, artifacts, and stream events at the boundary
- **9 typed error classes** — `TaskNotFoundError`, `UnsupportedOperationError`, `VersionNotSupportedError`, and more
- **Zero runtime dependencies** beyond `zod` — lightweight and tree-shakeable
- **Dual ESM/CJS output** — works with `import` and `require`

## Quick Start

```typescript
import { TaskSchema, type TaskState, A2AError } from "@reaatech/a2a-reference-core";

// Validate a task at the boundary
const rawTask = JSON.parse(incomingJson);
const task = TaskSchema.parse(rawTask);

// Check terminal states (TaskState is a string union: "submitted" | "working" | ...)
if (task.status.state === "completed") {
  console.log("Task finished:", task.artifacts);
}

// Throw typed errors
throw new A2AError("CUSTOM_ERROR", "Something went wrong", { extra: "context" });
```

## Exports

### Content Parts

The atomic content unit in A2A. All messages and artifacts are composed of parts.

| Export | Description |
|--------|-------------|
| `PartSchema` / `Part` | Discriminated union of `TextPart`, `FilePart`, `DataPart` |
| `TextPartSchema` / `TextPart` | `{ kind: "text", text: string, metadata?: Record<string, unknown> }` |
| `FilePartSchema` / `FilePart` | `{ kind: "file", file: { name?, mimeType?, bytes?, uri? }, metadata? }` |
| `DataPartSchema` / `DataPart` | `{ kind: "data", data: Record<string, unknown>, metadata? }` |

### Tasks & Messages

| Export | Description |
|--------|-------------|
| `TaskSchema` / `Task` | Central entity: `id`, `contextId?`, `status`, `artifacts?`, `history?`, `metadata?` |
| `TaskStatusSchema` / `TaskStatus` | `{ state: TaskState, message?, timestamp? }` |
| `TaskState` / `TaskStateSchema` | Enum: `submitted`, `working`, `input-required`, `completed`, `failed`, `canceled`, `rejected`, `auth-required` |
| `MessageSchema` / `Message` | `{ messageId, role: "user" \| "agent", parts: Part[], contextId?, taskId? }` |
| `ArtifactSchema` / `Artifact` | `{ artifactId?, name?, description?, parts: Part[], metadata? }` |

### Agent Card

| Export | Description |
|--------|-------------|
| `AgentCardSchema` / `AgentCard` | Full agent descriptor: name, description, url, capabilities, skills, security, interfaces |
| `SkillSchema` / `Skill` | A declared skill: `id`, `name`, `description`, `tags`, `parameters?` |
| `CapabilitySchema` / `Capability` | `{ streaming?, pushNotifications?, stateTransitionHistory? }` |
| `AgentInterfaceSchema` / `AgentInterface` | `{ url, protocolBinding, protocolVersion }` |

### Security Schemes

| Export | Description |
|--------|-------------|
| `SecuritySchemeSchema` / `SecurityScheme` | Union of all four scheme types |
| `ApiKeySecurityScheme` / Schema | API key in header, query, or cookie |
| `HttpSecurityScheme` / Schema | HTTP Bearer authentication |
| `OAuth2SecurityScheme` / Schema | OAuth2 with flows and scopes |
| `OpenIdConnectSecurityScheme` / Schema | OpenID Connect with discovery URL |

### Streaming Events

| Export | Description |
|--------|-------------|
| `StreamResponseSchema` / `StreamResponse` | SSE event union: `task`, `message`, `status`, `artifact` |
| `TaskStatusUpdateEventSchema` / `TaskStatusUpdateEvent` | `{ kind: "status", taskId?, status: TaskStatus, final? }` |
| `TaskArtifactUpdateEventSchema` / `TaskArtifactUpdateEvent` | `{ kind: "artifact", taskId?, artifact: Artifact, append?, lastChunk? }` |

### A2A API Requests & Responses

| Export | Description |
|--------|-------------|
| `SendMessageRequest` / `Response` | Send a message to an agent, returns a `Task` |
| `GetTaskRequest` / `Response` | Retrieve a task by ID |
| `ListTasksRequest` / `Response` | Paginated task listing with optional filters |
| `CancelTaskRequest` / `Response` | Cancel an in-progress task |
| `SubscribeToTaskRequest` | Subscribe to task SSE stream |
| `TaskPushNotificationConfig` | Webhook push notification configuration |

### Error Classes

All errors extend `A2AError` which includes `code: string`, `message: string`, and optional `details?: unknown`.

| Class | Code | When |
|-------|------|------|
| `A2AError` | (custom) | Base class for all A2A errors |
| `TaskNotFoundError` | `TaskNotFoundError` | Requested task does not exist |
| `TaskNotCancelableError` | `TaskNotCancelableError` | Task is in a terminal state |
| `PushNotificationNotSupportedError` | `PushNotificationNotSupportedError` | Agent lacks push notification capability |
| `UnsupportedOperationError` | `UnsupportedOperationError` | Operation not implemented by agent |
| `ContentTypeNotSupportedError` | `ContentTypeNotSupportedError` | Content type not accepted |
| `InvalidAgentResponseError` | `InvalidAgentResponseError` | Downstream agent returned invalid response |
| `ExtendedAgentCardNotConfiguredError` | `ExtendedAgentCardNotConfiguredError` | Extended card retrieval not configured |
| `ExtensionSupportRequiredError` | `ExtensionSupportRequiredError` | Required protocol extension not supported |
| `VersionNotSupportedError` | `VersionNotSupportedError` | Unsupported protocol version |

## Usage Pattern

Every schema export has a matching type export. Use the schema for runtime validation and the type for compile-time checking:

```typescript
import { TaskSchema, type Task } from "@reaatech/a2a-reference-core";

function handleResponse(raw: unknown): Task {
  // Parse at the boundary — throws ZodError on invalid data
  return TaskSchema.parse(raw);
}
```

## Related Packages

- [`@reaatech/a2a-reference-server`](https://www.npmjs.com/package/@reaatech/a2a-reference-server) — Express and Hono server adapters
- [`@reaatech/a2a-reference-client`](https://www.npmjs.com/package/@reaatech/a2a-reference-client) — Client SDK for agent discovery and task management
- [`@reaatech/a2a-reference-auth`](https://www.npmjs.com/package/@reaatech/a2a-reference-auth) — Authentication strategies

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
