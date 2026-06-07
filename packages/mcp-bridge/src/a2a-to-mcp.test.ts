import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AgentCard, Skill } from '@reaatech/a2a-reference-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A2aAsMcpServer } from './a2a-to-mcp.js';

const mockHandlers = new Map<
  string,
  (request: Record<string, unknown>) => Promise<Record<string, unknown>>
>();

// Mutable mock state for A2AClient
const mockA2AState = vi.hoisted(() => ({
  agentCard: {
    name: 'Remote Agent',
    description: 'Remote',
    url: 'http://localhost:3000',
    version: '1.0.0',
    protocolVersion: '0.3.0',
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'calculate', name: 'Calculate', description: 'Math', tags: [] }] as Skill[],
    supportedInterfaces: [
      { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
    ],
  } as AgentCard,
  sendMessageResult: { id: 'task-1', status: { state: 'submitted' } } as Record<string, unknown>,
  getTaskResult: {
    id: 'task-1',
    status: { state: 'completed' },
    artifacts: [{ name: 'result', parts: [{ kind: 'text', text: '42' }] }],
  } as Record<string, unknown>,
  subscribeEvents: [] as Array<unknown>,
}));

// Mutable mock state for MCP Server
const mockServerState = vi.hoisted(() => ({
  clientCapabilities: undefined as { sampling?: Record<string, unknown> } | undefined,
  createMessageResult: undefined as Record<string, unknown> | Promise<never> | undefined,
}));

// Mock the A2AClient
vi.mock('@reaatech/a2a-reference-client', () => ({
  A2AClient: vi.fn().mockImplementation(() => ({
    getAgentCard: vi.fn().mockImplementation(() => Promise.resolve(mockA2AState.agentCard)),
    sendMessage: vi.fn().mockImplementation(() => Promise.resolve(mockA2AState.sendMessageResult)),
    getTask: vi.fn().mockImplementation(() => Promise.resolve(mockA2AState.getTaskResult)),
    subscribe: vi.fn().mockImplementation(async function* () {
      for (const event of mockA2AState.subscribeEvents) {
        yield event;
      }
    }),
  })),
}));

// Mock MCP SDK Server
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi
      .fn()
      .mockImplementation(
        (
          schema: unknown,
          handler: (req: Record<string, unknown>) => Promise<Record<string, unknown>>,
        ) => {
          const key =
            schema === ListToolsRequestSchema
              ? 'listTools'
              : schema === CallToolRequestSchema
                ? 'callTool'
                : 'unknown';
          mockHandlers.set(key, handler);
        },
      ),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getClientCapabilities: vi.fn().mockImplementation(() => mockServerState.clientCapabilities),
    createMessage: vi
      .fn()
      .mockImplementation(() => Promise.resolve(mockServerState.createMessageResult)),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

// Mock global fetch for sendTaskMessage
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('A2aAsMcpServer', () => {
  beforeEach(() => {
    mockHandlers.clear();
    mockA2AState.agentCard = {
      name: 'Remote Agent',
      description: 'Remote',
      url: 'http://localhost:3000',
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: { streaming: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [{ id: 'calculate', name: 'Calculate', description: 'Math', tags: [] }] as Skill[],
      supportedInterfaces: [
        { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
      ],
    } as AgentCard;
    mockA2AState.sendMessageResult = { id: 'task-1', status: { state: 'submitted' } };
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'completed' },
      artifacts: [{ name: 'result', parts: [{ kind: 'text', text: '42' }] }],
    };
    mockA2AState.subscribeEvents = [];
    mockServerState.clientCapabilities = undefined;
    mockServerState.createMessageResult = {
      model: 'test-model',
      role: 'assistant',
      content: { type: 'text', text: 'User input' },
    };
    mockFetch.mockReset();
  });

  it('constructs with options', () => {
    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    expect(server).toBeDefined();
  });

  it('initializes and registers tool handlers', async () => {
    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    expect(mockHandlers.has('listTools')).toBe(true);
    expect(mockHandlers.has('callTool')).toBe(true);
  });

  it('listTools returns skills as tools with preserved schema', async () => {
    mockA2AState.agentCard.skills = [
      {
        id: 'calculate',
        name: 'Calculate',
        description: 'Math',
        tags: [],
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string' } },
          required: ['expression'],
        },
      },
    ] as Skill[];

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const listHandler = mockHandlers.get('listTools');
    if (!listHandler) throw new Error('Missing listTools handler');
    const result = (await listHandler({} as never)) as {
      tools: Array<{ inputSchema: Record<string, unknown> | undefined }>;
    };
    expect(result.tools[0].inputSchema).toEqual({
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    });
  });

  it('falls back to generic inputSchema when skill has no parameters', async () => {
    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const listHandler = mockHandlers.get('listTools');
    if (!listHandler) throw new Error('Missing listTools handler');
    const result = (await listHandler({} as never)) as {
      tools: Array<{ inputSchema: Record<string, unknown> | undefined }>;
    };
    expect(result.tools[0].inputSchema).toEqual({
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Input for the skill',
        },
      },
      required: ['input'],
    });
  });

  it('callTool executes an A2A task via polling and returns artifacts', async () => {
    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never);
    expect(result).toEqual({
      content: [{ type: 'text', text: '42' }],
    });
  });

  it('uses streaming when agent supports it', async () => {
    mockA2AState.agentCard.capabilities.streaming = true;
    mockA2AState.subscribeEvents = [
      { kind: 'task', task: { id: 'task-1', status: { state: 'submitted' } } },
      { kind: 'status', status: { state: 'working' } },
      {
        kind: 'artifact',
        artifact: { parts: [{ kind: 'text', text: 'Streaming result' }] },
      },
      { kind: 'status', status: { state: 'completed' } },
    ];

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never);
    expect(result).toEqual({
      content: [{ type: 'text', text: '42' }],
    });
  });

  it('falls back to polling when streaming throws', async () => {
    mockA2AState.agentCard.capabilities.streaming = true;
    mockA2AState.subscribeEvents = [
      { kind: 'task', task: { id: 'task-1', status: { state: 'submitted' } } },
      new Error('Stream failed'),
    ];

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never);
    expect(result).toEqual({
      content: [{ type: 'text', text: '42' }],
    });
  });

  it('handles input-required via MCP sampling when supported', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: {
        state: 'input-required',
        message: {
          messageId: 'ask-1',
          role: 'agent',
          parts: [{ kind: 'text', text: 'What is your name?' }],
        },
      },
      artifacts: [],
    };

    mockA2AState.sendMessageResult = {
      id: 'task-1',
      status: { state: 'completed' },
      artifacts: [{ name: 'result', parts: [{ kind: 'text', text: 'Hello, User' }] }],
    } as Record<string, unknown>;

    mockServerState.clientCapabilities = { sampling: {} };

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');

    const result = await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Hello, User' }],
    });
  });

  it('throws when input-required but sampling is not supported', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: {
        state: 'input-required',
        message: {
          messageId: 'ask-1',
          role: 'agent',
          parts: [{ kind: 'text', text: 'What is your name?' }],
        },
      },
      artifacts: [],
    };

    mockServerState.clientCapabilities = undefined;

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    await expect(
      callHandler({
        params: { name: 'calculate', arguments: { expression: '2+2' } },
      } as never),
    ).rejects.toThrow('does not support sampling');
  });

  it('throws when task times out', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'working' },
      artifacts: [],
    };

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');

    const originalSetTimeout = globalThis.setTimeout;
    // @ts-expect-error - mock setTimeout to fire immediately for fast polling
    globalThis.setTimeout = (cb: () => void) => {
      cb();
      return 0;
    };

    try {
      await expect(
        callHandler({
          params: { name: 'calculate', arguments: { expression: '2+2' } },
        } as never),
      ).rejects.toThrow('timed out');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it('returns error content for failed tasks', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: {
        state: 'failed',
        message: {
          messageId: 'err-1',
          role: 'agent',
          parts: [{ kind: 'text', text: 'Division by zero' }],
        },
      },
      artifacts: [],
    };

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Task failed: Division by zero' }],
      isError: true,
    });
  });

  it('closes the underlying MCP server', async () => {
    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    await server.close();
    expect(
      vi.mocked((await import('@modelcontextprotocol/sdk/server/index.js')).Server),
    ).toBeDefined();
  });

  it('returns error for unknown tool', async () => {
    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    await expect(
      callHandler({
        params: { name: 'unknown_tool', arguments: {} },
      } as never),
    ).rejects.toThrow('Unknown tool: unknown_tool');
  });

  it('returns error content for canceled tasks', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'canceled' },
      artifacts: [],
    };

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = (await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never)) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('canceled');
  });

  it('returns error content for rejected tasks', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: {
        state: 'rejected',
        message: { messageId: 'm', role: 'agent', parts: [{ kind: 'text', text: 'No' }] },
      },
      artifacts: [],
    };

    const server = new A2aAsMcpServer({
      a2aAgentUrl: 'http://localhost:3000',
    });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = (await callHandler({
      params: { name: 'calculate', arguments: { expression: '2+2' } },
    } as never)) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('rejected');
  });

  it('maps file artifact with bytes', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'completed' },
      artifacts: [
        { name: 'img', parts: [{ kind: 'file', file: { name: 'pic.png', bytes: 'base64data' } }] },
      ],
    };

    const server = new A2aAsMcpServer({ a2aAgentUrl: 'http://localhost:3000' });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = (await callHandler({
      params: { name: 'calculate', arguments: {} },
    } as never)) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain('[File: pic.png]');
    expect(result.content[0].text).toContain('base64data');
  });

  it('maps file artifact with uri', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'completed' },
      artifacts: [
        {
          name: 'doc',
          parts: [{ kind: 'file', file: { name: 'doc.pdf', uri: 'https://example.com/doc.pdf' } }],
        },
      ],
    };

    const server = new A2aAsMcpServer({ a2aAgentUrl: 'http://localhost:3000' });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = (await callHandler({
      params: { name: 'calculate', arguments: {} },
    } as never)) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('[File URI: https://example.com/doc.pdf]');
  });

  it('maps data artifact parts', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'completed' },
      artifacts: [{ name: 'data', parts: [{ kind: 'data', data: { key: 'value' } }] }],
    };

    const server = new A2aAsMcpServer({ a2aAgentUrl: 'http://localhost:3000' });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = (await callHandler({
      params: { name: 'calculate', arguments: {} },
    } as never)) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('{"key":"value"}');
  });

  it('maps unsupported artifact parts', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: { state: 'completed' },
      artifacts: [
        {
          name: 'x',
          parts: [{ kind: 'unknown' as 'text', text: 'should not reach' }],
        },
      ],
    };

    const server = new A2aAsMcpServer({ a2aAgentUrl: 'http://localhost:3000' });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    const result = (await callHandler({
      params: { name: 'calculate', arguments: {} },
    } as never)) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('[Unsupported part type]');
  });

  it('throws when sampling fails', async () => {
    mockA2AState.getTaskResult = {
      id: 'task-1',
      status: {
        state: 'input-required',
        message: { messageId: 'ask-1', role: 'agent', parts: [{ kind: 'text', text: 'What?' }] },
      },
      artifacts: [],
    };
    mockServerState.clientCapabilities = { sampling: {} };
    mockServerState.createMessageResult = Promise.reject(new Error('Sampling failed'));

    const server = new A2aAsMcpServer({ a2aAgentUrl: 'http://localhost:3000' });
    await server.initialize();
    const callHandler = mockHandlers.get('callTool');
    if (!callHandler) throw new Error('Missing callTool handler');
    await expect(
      callHandler({ params: { name: 'calculate', arguments: {} } } as never),
    ).rejects.toThrow('sampling request failed');
  });
});
