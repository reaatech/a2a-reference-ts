# @reaatech/a2a-reference-mcp-bridge

Bidirectional A2A ↔ MCP protocol adapter.

## A2A → MCP: Call MCP tools from A2A agents

```ts
import { McpToolAdapter } from '@reaatech/a2a-reference-mcp-bridge';

const adapter = new McpToolAdapter({
  serverUrl: 'http://localhost:3001/sse',
  clientId: 'a2a-agent',
});
await adapter.initialize();
const enrichedCard = adapter.getAgentCard(); // adds MCP tools as skills
```

## MCP → A2A: Expose A2A agent as MCP server

```ts
import { A2aAsMcpServer } from '@reaatech/a2a-reference-mcp-bridge';

const mcpServer = new A2aAsMcpServer({
  a2aAgentUrl: 'https://agent.example.com',
});
await mcpServer.start({ transport: 'stdio' });
```

## Schema Mapping

| MCP Concept | A2A Concept |
|-------------|-------------|
| `tools/list` | `skills` array in Agent Card |
| Tool input schema | Skill parameters (JSON Schema) |
| `tools/call` result | Artifact with `parts` |
| Resource | Artifact with URI addressing |
| Prompt | Message template |
| Sampling | `input-required` task state |
