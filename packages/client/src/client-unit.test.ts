import {
  A2AError,
  InvalidAgentResponseError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '@a2a-ref/core';
import { describe, expect, it, vi } from 'vitest';
import { A2AClient } from './client.js';

function createAgentCardResponse(overrides: Record<string, unknown> = {}) {
  return () =>
    Response.json({
      name: 'Test Agent',
      description: 'A test agent',
      url: 'http://localhost:3000',
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [{ id: 'test', name: 'Test', description: 'Test skill', tags: [] }],
      supportedInterfaces: [
        { url: 'http://localhost:3000', protocolBinding: 'a2a', protocolVersion: '0.3.0' },
      ],
      ...overrides,
    });
}

function createJsonRpcResponse(
  result: unknown,
  error?: { code?: number | string; message: string },
) {
  return () =>
    Response.json({
      jsonrpc: '2.0',
      id: 'test-id',
      result,
      error,
    });
}

function createReadableStream(lines: string[]) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < lines.length) {
        controller.enqueue(new TextEncoder().encode(lines[index++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('A2AClient unit tests', () => {
  it('caches agent card and respects TTL', async () => {
    const mockFetch = vi.fn().mockImplementation(createAgentCardResponse());
    const client = new A2AClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: mockFetch,
      agentCardTtlMs: 5000,
    });

    const card1 = await client.getAgentCard();
    expect(card1.name).toBe('Test Agent');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const card2 = await client.getAgentCard();
    expect(card2).toBe(card1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('expires agent card cache after TTL', async () => {
    const mockFetch = vi.fn().mockImplementation(createAgentCardResponse());
    const client = new A2AClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: mockFetch,
      agentCardTtlMs: 0,
    });

    await client.getAgentCard();
    await client.getAgentCard();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clears agent card cache', async () => {
    const mockFetch = vi.fn().mockImplementation(createAgentCardResponse());
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await client.getAgentCard();
    client.clearAgentCardCache();
    await client.getAgentCard();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws UnsupportedOperationError when streaming is disabled for sendSubscribe', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(createAgentCardResponse({ capabilities: { streaming: false } }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('throws UnsupportedOperationError when streaming is disabled for subscribe', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(createAgentCardResponse({ capabilities: { streaming: false } }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.subscribe('task-1')) {
          // noop
        }
      })(),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('throws TaskNotFoundError for not found task', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(
        createJsonRpcResponse(undefined, { message: 'Task not found: task-123' }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.getTask('task-123')).rejects.toThrow(TaskNotFoundError);
  });

  it('throws InvalidAgentResponseError for malformed JSON-RPC response', async () => {
    const mockFetch = vi.fn().mockImplementation(() => Response.json({ invalid: true }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.getTask('task-1')).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws InvalidAgentResponseError for Zod validation failure on task', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(createJsonRpcResponse({ id: 'task-1', missingStatus: true }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.getTask('task-1')).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws A2AError for HTTP errors', async () => {
    const mockFetch = vi.fn().mockImplementation(() => new Response(null, { status: 500 }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.getAgentCard()).rejects.toThrow(A2AError);
  });

  it('parses SSE stream events from sendSubscribe', async () => {
    const stream = createReadableStream([
      'data: {"kind":"task","task":{"id":"t1","status":{"state":"submitted"}}}\n\n',
      'data: {"kind":"status","status":{"state":"working"}}\n\n',
      'data: {"kind":"artifact","artifact":{"parts":[{"kind":"text","text":"Done"}]}}\n\n',
    ]);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    const events: unknown[] = [];
    for await (const event of client.sendSubscribe({
      messageId: '1',
      role: 'user',
      parts: [{ kind: 'text', text: 'hi' }],
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: 'task', task: { id: 't1' } });
    expect(events[1]).toMatchObject({ kind: 'status', status: { state: 'working' } });
    expect(events[2]).toMatchObject({
      kind: 'artifact',
      artifact: { parts: [{ kind: 'text', text: 'Done' }] },
    });
  });

  it('parses SSE stream events from subscribe', async () => {
    const stream = createReadableStream([
      'data: {"kind":"task","task":{"id":"t1","status":{"state":"working"}}}\n\n',
      'data: {"kind":"status","status":{"state":"completed"},"final":true}\n\n',
    ]);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    const events: unknown[] = [];
    for await (const event of client.subscribe('t1')) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'task', task: { id: 't1' } });
    expect(events[1]).toMatchObject({ kind: 'status', status: { state: 'completed' } });
  });

  it('releases reader lock when stream read throws', async () => {
    const releaseLock = vi.fn();
    const read = vi.fn().mockRejectedValue(new Error('Stream error'));
    const mockBody = {
      getReader: () => ({ read, releaseLock }),
    } as unknown as ReadableStream<Uint8Array>;

    const mockResponse = {
      ok: true,
      body: mockBody,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as unknown as Response;

    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockResolvedValueOnce(mockResponse);
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    const gen = client.sendSubscribe({
      messageId: '1',
      role: 'user',
      parts: [{ kind: 'text', text: 'hi' }],
    });

    await expect(gen.next()).rejects.toThrow('Stream error');
    expect(releaseLock).toHaveBeenCalled();
  });

  it('throws A2AError when discover fetch fails', async () => {
    const mockFetch = vi.fn().mockImplementation(() => new Response(null, { status: 404 }));
    await expect(
      A2AClient.discover('http://localhost:3000/.well-known/agent.json', mockFetch),
    ).rejects.toThrow(A2AError);
  });

  it('accepts mismatched protocol version in discover without warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = vi
      .fn()
      .mockImplementation(createAgentCardResponse({ protocolVersion: '0.2.0' }));
    const client = await A2AClient.discover(
      'http://localhost:3000/.well-known/agent.json',
      mockFetch,
    );
    expect(client).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('validates listTasks response', async () => {
    const mockFetch = vi.fn().mockImplementation(
      createJsonRpcResponse({
        tasks: [{ id: 't1', status: { state: 'completed' } }],
        nextPageToken: 'token1',
        totalSize: 1,
      }),
    );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    const result = await client.listTasks();
    expect(result.tasks).toHaveLength(1);
    expect(result.nextPageToken).toBe('token1');
    expect(result.totalSize).toBe(1);
  });

  it('throws InvalidAgentResponseError for invalid SSE event', async () => {
    const stream = createReadableStream(['data: {"kind":"invalid","foo":"bar"}\n\n']);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws A2AError when subscribe response has no body', async () => {
    const mockResponse = {
      ok: true,
      body: null,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as unknown as Response;

    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockResolvedValueOnce(mockResponse);
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.subscribe('task-1')) {
          // noop
        }
      })(),
    ).rejects.toThrow(A2AError);
  });

  it('throws InvalidAgentResponseError for malformed SSE JSON in stream', async () => {
    const stream = createReadableStream(['data: not-json\n\n']);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(InvalidAgentResponseError);
  });

  it('processes remaining buffered SSE data without trailing newline', async () => {
    const stream = createReadableStream([
      'data: {"kind":"task","task":{"id":"t1","status":{"state":"submitted"}}}',
    ]);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    const events: unknown[] = [];
    for await (const event of client.sendSubscribe({
      messageId: '1',
      role: 'user',
      parts: [{ kind: 'text', text: 'hi' }],
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'task', task: { id: 't1' } });
  });

  it('throws A2AError when subscribe returns HTTP error', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.subscribe('task-1')) {
          // noop
        }
      })(),
    ).rejects.toThrow(A2AError);
  });

  it('throws InvalidAgentResponseError for malformed SSE JSON in remaining buffer', async () => {
    const stream = createReadableStream(['data: not-json']);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws InvalidAgentResponseError for invalid SSE event in remaining buffer', async () => {
    const stream = createReadableStream(['data: {"kind":"invalid","foo":"bar"}']);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws A2AError for JSON-RPC HTTP errors', async () => {
    const mockFetch = vi.fn().mockImplementation(() => new Response(null, { status: 503 }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.getTask('task-1')).rejects.toThrow(A2AError);
  });

  it('throws A2AError for generic server errors', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(createJsonRpcResponse(undefined, { message: 'Internal server error' }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.getTask('task-1')).rejects.toThrow(A2AError);
  });

  it('throws InvalidAgentResponseError for invalid sendMessage response', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(createJsonRpcResponse({ id: 'task-1', missingStatus: true }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      client.sendMessage({ messageId: '1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] }),
    ).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws InvalidAgentResponseError for invalid listTasks response', async () => {
    const mockFetch = vi.fn().mockImplementation(createJsonRpcResponse({ tasks: 'not-an-array' }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.listTasks()).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws InvalidAgentResponseError for invalid cancelTask response', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(createJsonRpcResponse({ id: 'task-1', missingStatus: true }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(client.cancelTask('task-1')).rejects.toThrow(InvalidAgentResponseError);
  });

  it('throws A2AError when sendSubscribe returns HTTP error', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(A2AError);
  });

  it('throws A2AError when sendSubscribe response has no body', async () => {
    const mockResponse = {
      ok: true,
      body: null,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as unknown as Response;

    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockResolvedValueOnce(mockResponse);
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    await expect(
      (async () => {
        for await (const _ of client.sendSubscribe({
          messageId: '1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        })) {
          // noop
        }
      })(),
    ).rejects.toThrow(A2AError);
  });

  it('sendSubscribe sets Accept: text/event-stream header', async () => {
    const stream = createReadableStream([]);
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(createAgentCardResponse())
      .mockImplementationOnce(
        () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      );
    const client = new A2AClient({ baseUrl: 'http://localhost:3000', fetchImpl: mockFetch });

    for await (const _ of client.sendSubscribe({
      messageId: '1',
      role: 'user',
      parts: [{ kind: 'text', text: 'hi' }],
    })) {
      // noop
    }

    const postCall = mockFetch.mock.calls[1];
    expect(postCall[1].headers.Accept).toBe('text/event-stream');
  });

  it('discover populates agent card cache', async () => {
    const mockFetch = vi.fn().mockImplementation(createAgentCardResponse());
    const client = await A2AClient.discover(
      'http://localhost:3000/.well-known/agent.json',
      mockFetch,
    );

    const card = await client.getAgentCard();
    expect(card.name).toBe('Test Agent');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx errors with exponential backoff', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockImplementationOnce(
        createJsonRpcResponse({ id: 'task-1', status: { state: 'submitted' } }),
      );
    const client = new A2AClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: mockFetch,
      maxRetries: 2,
      retryDelayMs: 50,
    });

    const result = await client.sendMessage({
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    expect(result.id).toBe('task-1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx errors', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
    const client = new A2AClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: mockFetch,
      maxRetries: 2,
      retryDelayMs: 50,
    });

    await expect(
      client.sendMessage({
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
      }),
    ).rejects.toThrow('HTTP error: 404');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on AbortError (timeout)', async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(
        createJsonRpcResponse({ id: 'task-1', status: { state: 'submitted' } }),
      );
    const client = new A2AClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: mockFetch,
      maxRetries: 2,
      retryDelayMs: 50,
    });

    const result = await client.sendMessage({
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    expect(result.id).toBe('task-1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exceeded', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const client = new A2AClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: mockFetch,
      maxRetries: 1,
      retryDelayMs: 50,
    });

    await expect(
      client.sendMessage({
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
      }),
    ).rejects.toThrow('fetch failed');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
