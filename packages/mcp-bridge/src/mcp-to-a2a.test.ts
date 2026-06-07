import { describe, expect, it, vi } from 'vitest';
import { McpToolAdapter } from './mcp-to-a2a.js';

describe('McpToolAdapter', () => {
  it('constructs with options', () => {
    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });
    expect(adapter).toBeDefined();
  });

  it('returns agent card with skills after initialization', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'read_file', description: 'Read a file' },
          { name: 'write_file', description: 'Write a file' },
        ],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    // Replace the internal client with our mock
    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    const card = adapter.getAgentCard();
    expect(card.skills).toHaveLength(2);
    expect(card.skills[0].id).toBe('read_file');
  });

  it('preserves MCP tool inputSchema in skill parameters', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'calculate',
            description: 'Calculate something',
            inputSchema: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
          },
        ],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    const card = adapter.getAgentCard();
    expect(card.skills[0].parameters).toEqual({
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    });
  });

  it('executes task by calling MCP tool with text input', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'read_file', description: 'Read a file' }],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'file contents' }],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    const artifacts = await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'read_file /tmp/test.txt' }],
      },
    );

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'read_file',
      arguments: { input: 'read_file /tmp/test.txt' },
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].parts[0].kind).toBe('text');
    expect((artifacts[0].parts[0] as { text: string }).text).toBe('file contents');
  });

  it('passes structured arguments from DataPart to MCP tool', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'calculate', description: 'Math' }],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '42' }],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'data', data: { expression: '2+2' } }],
      },
    );

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'calculate',
      arguments: { expression: '2+2' },
    });
  });

  it('parses JSON text as structured arguments', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'calculate', description: 'Math' }],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '42' }],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: '{"expression": "2+2"}' }],
      },
    );

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'calculate',
      arguments: { expression: '2+2' },
    });
  });

  it('returns image artifacts for image content', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'screenshot', description: 'Take screenshot' }],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    const artifacts = await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'screenshot' }],
      },
    );

    expect(artifacts[0].parts[0].kind).toBe('file');
  });

  it('throws on invalid MCP tool result', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'bad_tool', description: 'Bad' }],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'invalid', text: '' }],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await expect(
      adapter.executeTask(
        { id: 'task-1', status: { state: 'working' } },
        {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'bad_tool' }],
        },
      ),
    ).rejects.toThrow('Invalid MCP tool result');
  });

  it('throws when skill cannot be inferred', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'tool_a', description: 'A' },
          { name: 'tool_b', description: 'B' },
        ],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await expect(
      adapter.executeTask(
        { id: 'task-1', status: { state: 'working' } },
        {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'unknown command' }],
        },
      ),
    ).rejects.toThrow('Could not infer MCP tool');
  });

  it('disconnects the MCP client', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.disconnect();
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('throws McpToolCallError when callTool throws', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'read_file', description: 'Read' }] }),
      callTool: vi.fn().mockRejectedValue(new Error('Connection lost')),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await expect(
      adapter.executeTask(
        { id: 'task-1', status: { state: 'working' } },
        { messageId: 'msg-1', role: 'user', parts: [{ kind: 'text', text: 'read_file' }] },
      ),
    ).rejects.toThrow('MCP tool call failed: Connection lost');
  });

  it('throws McpToolCallError when MCP tool returns isError', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'read_file', description: 'Read' }] }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Permission denied' }],
        isError: true,
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await expect(
      adapter.executeTask(
        { id: 'task-1', status: { state: 'working' } },
        { messageId: 'msg-1', role: 'user', parts: [{ kind: 'text', text: 'read_file' }] },
      ),
    ).rejects.toThrow('MCP tool returned error: Permission denied');
  });

  it('falls back to JSON for unknown content types', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'audio', description: 'Audio' }] }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'audio', data: 'snd', mimeType: 'audio/wav' }],
      }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    const artifacts = await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      { messageId: 'msg-1', role: 'user', parts: [{ kind: 'text', text: 'audio' }] },
    );
    expect(artifacts[0].parts[0].kind).toBe('text');
    expect((artifacts[0].parts[0] as { text: string }).text).toBe(
      '{"type":"audio","data":"snd","mimeType":"audio/wav"}',
    );
  });

  it('returns empty arguments for message with no parsable parts', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'read_file', description: 'Read' }] }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      { messageId: 'msg-1', role: 'user', parts: [] },
    );
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'read_file', arguments: {} });
  });

  it('infers skill from data part skill reference', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'read_file', description: 'Read' }] }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };

    const adapter = new McpToolAdapter({
      mcpTransport: {} as never,
      agentCardBase: {
        name: 'Bridge Agent',
        description: 'Bridge',
        url: 'http://localhost:3000',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: { streaming: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportedInterfaces: [
          { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
        ],
      },
    });

    (adapter as unknown as { client: typeof mockClient }).client = mockClient;
    await adapter.initialize();

    await adapter.executeTask(
      { id: 'task-1', status: { state: 'working' } },
      { messageId: 'msg-1', role: 'user', parts: [{ kind: 'data', data: { skill: 'read_file' } }] },
    );
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'read_file',
      arguments: { skill: 'read_file' },
    });
  });
});
