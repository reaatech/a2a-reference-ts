# @reaatech/a2a-reference-mcp-bridge

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-mcp-bridge.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-mcp-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Bidirectional protocol adapter bridging the A2A (Agent-to-Agent) and MCP (Model Context Protocol) ecosystems. Expose A2A agent skills as MCP tools, and MCP tools as A2A skills — enabling interoperability between agent frameworks.

## Installation

```bash
npm install @reaatech/a2a-reference-mcp-bridge @modelcontextprotocol/sdk
# or
pnpm add @reaatech/a2a-reference-mcp-bridge @modelcontextprotocol/sdk
```

## Feature Overview

- **A2A → MCP** — wrap a remote A2A agent behind an MCP server, exposing its skills as MCP tools
- **MCP → A2A** — wrap MCP tools as A2A skills, making them available to A2A clients and orchestrators
- **Task polling and streaming** — both task completion strategies supported for A2A → MCP
- **Input-required handling** — leverages MCP sampling for interactive tool calls
- **Automatic schema mapping** — skill parameters ↔ MCP `inputSchema`, artifacts ↔ MCP content
- **Structured logging** — Pino-based logging for observability

## Quick Start

### A2A Agent as MCP Server

Expose a remote A2A agent's skills as MCP tools, consumable by MCP clients like Claude Desktop:

```typescript
import { A2aAsMcpServer } from "@reaatech/a2a-reference-mcp-bridge";

const server = new A2aAsMcpServer({
  a2aAgentUrl: "http://localhost:3000",
  name: "my-a2a-bridge",
  version: "1.0.0",
});

await server.initialize(); // Fetches agent card, registers MCP tool handlers
await server.run();        // Connects via stdio — ready for MCP clients
```

### MCP Tools as A2A Skills

Wrap MCP tools behind an A2A agent card, making them callable from the A2A ecosystem:

```typescript
import { McpToolAdapter } from "@reaatech/a2a-reference-mcp-bridge";
import { createA2AExpressApp } from "@reaatech/a2a-reference-server";

const adapter = new McpToolAdapter({
  mcpTransport: myMcpTransport,
  agentCardBase: {
    name: "MCP Bridge Agent",
    description: "Exposes MCP tools via A2A",
    url: "http://localhost:3004",
    version: "1.0.0",
    protocolVersion: "0.3.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    supportedInterfaces: [],
  },
});

await adapter.initialize();
const agentCard = adapter.getAgentCard(); // Skills auto-populated from MCP tools

const executor: AgentExecutor = {
  async execute(context, eventBus) {
    eventBus.emitStatusUpdate({ kind: "status", status: { state: "working" } });
    const artifacts = await adapter.executeTask(context.task, context.message);
    for (const artifact of artifacts) {
      eventBus.emitArtifactUpdate({ kind: "artifact", artifact });
    }
    eventBus.emitStatusUpdate({ kind: "status", status: { state: "completed" } });
  },
};

const app = createA2AExpressApp({ agentCard, executor });
app.listen(3004);
```

## API Reference

### `A2aAsMcpServer` (A2A → MCP)

Exposes an A2A agent behind an MCP server interface.

```typescript
class A2aAsMcpServer {
  constructor(options: A2aAsMcpServerOptions);

  initialize(): Promise<void>;  // Fetch card, register tools
  run(): Promise<void>;         // Connect via stdio
  close(): Promise<void>;       // Close MCP connection
}
```

#### `A2aAsMcpServerOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `a2aAgentUrl` | `string` | (required) | Base URL of the remote A2A agent |
| `name` | `string` | `"a2a-bridge-mcp-server"` | MCP server name |
| `version` | `string` | `"0.1.0"` | MCP server version |
| `maxPolls` | `number` | `60` | Max polling iterations before timeout |
| `pollIntervalMs` | `number` | `500` | Milliseconds between poll attempts |

#### How It Works

1. **`initialize()`** fetches the A2A agent card, maps each `Skill` to an MCP `Tool`:
   - Tool `name` = skill `id`
   - Tool `description` = skill `description`
   - Tool `inputSchema` = skill `parameters` (or a generic `{ input: string }` fallback)

2. **On tool call**, sends an A2A `Message` and waits for task completion via:
   - **Polling** (default): repeatedly calls `getTask()` until terminal state or `maxPolls` reached
   - **Streaming** (if `capabilities.streaming` is `true`): subscribes to SSE events

3. **Result mapping** converts A2A artifacts to MCP content:
   - `TextPart` → `{ type: "text", text }`
   - `FilePart` → `{ type: "text", text: "[File: name]\n<bytes>" }`
   - `DataPart` → `{ type: "text", text: JSON.stringify(data) }`

4. **`input-required` handling**: requests MCP sampling from the client for LLM-generated input

### `McpToolAdapter` (MCP → A2A)

Wraps MCP tools behind an A2A agent card.

```typescript
class McpToolAdapter {
  constructor(options: McpToolAdapterOptions);

  initialize(): Promise<void>;                                // Connect MCP client, list tools
  getAgentCard(): AgentCard;                                  // Agent card with MCP tools as skills
  executeTask(task: Task, message: Message): Promise<Artifact[]>;  // Invoke MCP tool
  disconnect(): Promise<void>;                                // Close MCP client
}
```

#### `McpToolAdapterOptions`

| Property | Type | Description |
|----------|------|-------------|
| `mcpTransport` | `Transport` (MCP SDK) | Transport layer to the MCP server |
| `agentCardBase` | `Omit<AgentCard, "skills">` | Base agent card (skills are auto-populated) |

#### How It Works

1. **`initialize()`** connects to the MCP server and calls `tools/list`, mapping each tool to an A2A `Skill`:
   - `skill.id` = tool `name`
   - `skill.name` = tool `name`
   - `skill.tags` = `["mcp"]`
   - `skill.parameters` = tool `inputSchema`

2. **`executeTask()`** determines which tool to call via heuristic:
   - Checks if the first text part starts with a known skill ID
   - Checks for explicit `{ skill: "toolName" }` in a `DataPart`
   - Falls back to the first skill if only one exists

3. **Argument extraction**:
   - `DataPart` payload used directly
   - JSON text body parsed as structured arguments
   - Plain text wrapped as `{ input: text }`

4. **Result mapping** converts MCP content to A2A artifacts:
   - `TextContent` → `{ kind: "text", text }`
   - `ImageContent` → `{ kind: "file", file: { bytes, mimeType } }`
   - Failed tool calls throw `McpToolCallError`

## Bridge Direction Summary

| Direction | Class | Use Case |
|-----------|-------|----------|
| A2A → MCP | `A2aAsMcpServer` | Make A2A agents available to MCP clients (Claude Desktop, Cursor, etc.) |
| MCP → A2A | `McpToolAdapter` | Make MCP tools available to A2A orchestrators and agent workflows |

## Example: Complete Bridge Setup

See the [`04-mcp-bridge` example](https://github.com/reaatech/a2a-reference-ts/tree/main/examples/04-mcp-bridge) in the repository for a working end-to-end demonstration.

## Related Packages

- [`@reaatech/a2a-reference-core`](https://www.npmjs.com/package/@reaatech/a2a-reference-core) — Protocol types and Zod schemas
- [`@reaatech/a2a-reference-client`](https://www.npmjs.com/package/@reaatech/a2a-reference-client) — A2A client SDK (used internally)
- [`@reaatech/a2a-reference-server`](https://www.npmjs.com/package/@reaatech/a2a-reference-server) — A2A server framework
- [`@reaatech/a2a-reference-observability`](https://www.npmjs.com/package/@reaatech/a2a-reference-observability) — Pino-based logging

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
