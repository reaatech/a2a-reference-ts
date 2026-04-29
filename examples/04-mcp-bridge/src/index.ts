import { McpToolAdapter } from '@reaatech/a2a-reference-mcp-bridge';
import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import type { AgentExecutor } from '@reaatech/a2a-reference-server';

/**
 * MCP Bridge Demo
 *
 * This example demonstrates how to expose MCP tools as A2A skills.
 * In a real deployment, you would connect to an MCP server via stdio, SSE, or HTTP.
 * Here we show the adapter pattern with a mock MCP transport.
 */

// Mock MCP transport for demonstration purposes
const mockMcpTransport = {
  async request(req: unknown) {
    const method = (req as { method: string }).method;
    if (method === 'tools/list') {
      return {
        tools: [
          {
            name: 'read_file',
            description: 'Read a file from disk',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      };
    }
    if (method === 'tools/call') {
      const params = (req as { params: { name: string; arguments: Record<string, unknown> } })
        .params;
      if (params.name === 'read_file') {
        return {
          content: [
            {
              type: 'text',
              text: `Mock file content for ${params.arguments.path}`,
            },
          ],
        };
      }
    }
    throw new Error(`Unknown method: ${method}`);
  },
};

async function main() {
  const adapter = new McpToolAdapter({
    mcpTransport: mockMcpTransport as never,
    agentCardBase: {
      name: 'MCP Bridge Agent',
      description: 'An A2A agent powered by MCP tools',
      url: 'http://localhost:3004',
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      supportedInterfaces: [
        {
          url: 'http://localhost:3004',
          protocolBinding: 'a2a',
          protocolVersion: '0.3.0',
        },
      ],
    },
  });

  await adapter.initialize();
  const agentCard = adapter.getAgentCard();

  const executor: AgentExecutor = {
    async execute(context, eventBus) {
      eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
      const artifacts = await adapter.executeTask(context.task, context.message);
      for (const artifact of artifacts) {
        eventBus.emitArtifactUpdate({ kind: 'artifact', artifact });
      }
      eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
    },
  };

  const app = createA2AExpressApp({ agentCard, executor });
  app.listen(3004, () => {
    console.log('MCP Bridge Demo Agent on http://localhost:3004');
    console.log('');
    console.log('Skills exposed from MCP tools:');
    for (const skill of agentCard.skills) {
      console.log(`  - ${skill.id}: ${skill.description}`);
    }
  });
}

main().catch(console.error);
