# Bridge Adapter Deep Dive

The A2A ↔ MCP bridge is a bidirectional protocol adapter that lets A2A agents invoke MCP tools and lets MCP hosts delegate work to A2A agents.

## Direction A: A2A Agent → MCP Tools

`McpToolAdapter` connects to an MCP server over stdio, SSE, or HTTP, enumerates tools via `tools/list`, and maps each tool to an A2A Skill in the Agent Card.

When an A2A task targets that skill, the bridge:
1. Translates the task message to an MCP `tools/call` request.
2. Streams MCP progress notifications back as A2A `TaskStatusUpdateEvent`s.
3. Returns the final tool result as a `TaskArtifactUpdateEvent`.

### Schema Mapping

| MCP Concept | A2A Concept |
|-------------|-------------|
| `tools/list` | `skills` array in Agent Card |
| Tool input schema | Skill parameters (JSON Schema) |
| `tools/call` result | Artifact with `parts` |
| Resource | Artifact with URI addressing |
| Prompt | Message template |

### Configuration Example
```ts
import { McpToolAdapter } from '@a2a-ref/mcp-bridge';

const adapter = new McpToolAdapter({
  serverUrl: 'http://localhost:3001/sse',
  agentCard,
});
await adapter.initialize();
const enrichedCard = adapter.getAgentCard(); // adds MCP tools as skills
```

## Direction B: MCP Host → A2A Agent

`A2aAsMcpServer` wraps a remote A2A agent and exposes its skills as MCP tools. An MCP host can discover and call these tools without knowing anything about A2A.

When the host calls a tool:
1. The bridge creates an A2A task via `tasks/send` or `tasks/sendSubscribe`.
2. It waits for task completion (or streams SSE updates as MCP progress).
3. It maps the final artifacts back to the MCP `tools/call` result.

If the A2A agent enters the `input-required` state, the bridge can translate that into an MCP `sampling/createMessage` request so the host can provide the needed input.

### Configuration Example
```ts
import { A2aAsMcpServer } from '@a2a-ref/mcp-bridge';

const mcpServer = new A2aAsMcpServer({
  a2aAgentUrl: 'https://agent.example.com',
  authStrategy: new ApiKeyStrategy({ keys: new Set(['secret']) }),
});
await mcpServer.start({ transport: 'stdio' });
```

## Architecture

```
A2A Client ↔ Bridge Agent ↔ MCP Server
MCP Host  ↔ Bridge MCP Server ↔ A2A Agent
```

The bridge is not a proxy — it is an **adapter** that translates semantics:
- A2A "skills" ↔ MCP "tools" (both are capability declarations with JSON schema inputs)
- A2A "task lifecycle" ↔ MCP "tool invocation" (tasks are async + stateful; tools are sync/stateless)
- A2A "artifacts" ↔ MCP "tool results" + "resources"
- A2A "input-required" ↔ MCP "sampling" (both request LLM/user input mid-flight)

## Error Handling

Bridge errors are wrapped as `A2AError` instances with codes such as `bridge_mcp_connection_failed` or `bridge_task_timeout`. Always handle these at the application layer because MCP and A2A have different retry expectations.
