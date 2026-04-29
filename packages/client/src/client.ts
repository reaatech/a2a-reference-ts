import {
  A2AError,
  type AgentCard,
  AgentCardSchema,
  InvalidAgentResponseError,
  ListTasksResponseSchema,
  type Message,
  MessageSchema,
  type Task,
  type TaskArtifactUpdateEvent,
  TaskArtifactUpdateEventSchema,
  TaskNotFoundError,
  TaskSchema,
  type TaskStatusUpdateEvent,
  TaskStatusUpdateEventSchema,
  UnsupportedOperationError,
} from '@reaatech/a2a-reference-core';
import { z } from 'zod';

const EXPECTED_PROTOCOL_VERSION = '0.3.0';

const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.union([z.number(), z.string()]).optional(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

const TaskEventSchema = z.object({
  kind: z.literal('task'),
  task: TaskSchema,
});

const MessageEventSchema = z.object({
  kind: z.literal('message'),
  message: MessageSchema,
});

const SseEventSchema = z.union([
  TaskStatusUpdateEventSchema,
  TaskArtifactUpdateEventSchema,
  TaskEventSchema,
  MessageEventSchema,
]);

export interface A2AClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  agentCardTtlMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class A2AClient {
  private fetch: typeof fetch;
  private agentCardCache: AgentCard | null = null;
  private agentCardCacheTime = 0;
  private agentCardTtlMs: number;

  constructor(private options: A2AClientOptions) {
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.agentCardTtlMs = options.agentCardTtlMs ?? 5 * 60 * 1000; // 5 minutes
  }

  static async discover(cardUrl: string, fetchImpl?: typeof fetch): Promise<A2AClient> {
    const fetchFn = fetchImpl ?? globalThis.fetch;
    const response = await fetchFn(cardUrl);
    if (!response.ok) {
      throw new A2AError('HTTPError', `Failed to fetch agent card: ${response.status}`);
    }
    const data = await response.json();
    const card = AgentCardSchema.parse(data);
    if (card.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
      // Protocol version mismatch detected; consumers should verify compatibility
    }
    const client = new A2AClient({ baseUrl: card.url, fetchImpl: fetchFn });
    client.agentCardCache = card;
    client.agentCardCacheTime = Date.now();
    return client;
  }

  static async fromCardUrl(cardUrl: string, fetchImpl?: typeof fetch): Promise<A2AClient> {
    return A2AClient.discover(cardUrl, fetchImpl);
  }

  clearAgentCardCache(): void {
    this.agentCardCache = null;
    this.agentCardCacheTime = 0;
  }

  async getAgentCard(): Promise<AgentCard> {
    if (this.agentCardCache && Date.now() - this.agentCardCacheTime < this.agentCardTtlMs) {
      return this.agentCardCache;
    }

    const response = await this.fetch(`${this.options.baseUrl}/.well-known/agent.json`);
    if (!response.ok) {
      throw new A2AError('HTTPError', `Failed to fetch agent card: ${response.status}`);
    }
    const data = await response.json();
    const card = AgentCardSchema.parse(data);
    this.agentCardCache = card;
    this.agentCardCacheTime = Date.now();
    return card;
  }

  private async rpcCall(method: string, params: Record<string, unknown>): Promise<unknown> {
    const maxRetries = this.options.maxRetries ?? 0;
    const baseDelay = this.options.retryDelayMs ?? 1000;
    const timeoutMs = 30_000;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetch(this.options.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method,
            params,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Retry on 5xx and network-like errors; don't retry 4xx
          if (response.status >= 500 && attempt < maxRetries) {
            lastError = new A2AError('HTTPError', `HTTP error: ${response.status}`);
            await this.delay(this.exponentialBackoff(attempt, baseDelay));
            continue;
          }
          throw new A2AError('HTTPError', `HTTP error: ${response.status}`);
        }

        const raw = await response.json();
        const parsed = JsonRpcResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new InvalidAgentResponseError(`Invalid JSON-RPC response: ${parsed.error.message}`);
        }

        const { error, result } = parsed.data;
        if (error) {
          const msg = error.message ?? '';
          if (msg.toLowerCase().includes('not found')) {
            const match = msg.match(/Task not found:\s*(.+)/i) ?? msg.match(/:\s*(.+)$/);
            const taskId = match ? match[1].trim() : 'unknown';
            throw new TaskNotFoundError(taskId);
          }
          throw new A2AError('ServerError', msg, { code: error.code, data: error.data });
        }

        return result;
      } catch (err) {
        const isRetryable =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err.message.includes('fetch failed') ||
            err.message.includes('ECONNREFUSED'));
        if (isRetryable && attempt < maxRetries) {
          lastError = err instanceof Error ? err : new Error(String(err));
          await this.delay(this.exponentialBackoff(attempt, baseDelay));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new A2AError('HTTPError', 'Max retries exceeded');
  }

  private exponentialBackoff(attempt: number, baseDelay: number): number {
    const jitter = Math.random() * 0.3 * baseDelay;
    return Math.min(baseDelay * 2 ** attempt + jitter, 30_000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async sendMessage(message: Message, contextId?: string, taskId?: string): Promise<Task> {
    const result = await this.rpcCall('tasks/send', { message, contextId, taskId });
    const parsed = TaskSchema.safeParse(result);
    if (!parsed.success) {
      throw new InvalidAgentResponseError(`Invalid task response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async getTask(taskId: string): Promise<Task> {
    const result = await this.rpcCall('tasks/get', { id: taskId });
    const parsed = TaskSchema.safeParse(result);
    if (!parsed.success) {
      throw new InvalidAgentResponseError(`Invalid task response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async listTasks(): Promise<{ tasks: Task[]; nextPageToken?: string; totalSize?: number }> {
    const result = await this.rpcCall('tasks/list', {});
    const parsed = ListTasksResponseSchema.safeParse(result);
    if (!parsed.success) {
      throw new InvalidAgentResponseError(`Invalid list tasks response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async cancelTask(taskId: string): Promise<Task> {
    const result = await this.rpcCall('tasks/cancel', { id: taskId });
    const parsed = TaskSchema.safeParse(result);
    if (!parsed.success) {
      throw new InvalidAgentResponseError(`Invalid task response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async assertStreamingSupported(): Promise<void> {
    const card = await this.getAgentCard();
    if (!card.capabilities.streaming) {
      throw new UnsupportedOperationError('streaming');
    }
  }

  async *sendSubscribe(
    message: Message,
    contextId?: string,
  ): AsyncGenerator<
    | TaskStatusUpdateEvent
    | TaskArtifactUpdateEvent
    | { kind: 'task'; task: Task }
    | { kind: 'message'; message: Message }
  > {
    await this.assertStreamingSupported();

    const response = await this.fetch(`${this.options.baseUrl}/tasks/sendSubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message, contextId }),
    });

    if (!response.ok) {
      throw new A2AError('HTTPError', `HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new A2AError('HTTPError', 'No response body for SSE stream');
    }

    yield* this.parseSseStream(response.body);
  }

  async *subscribe(
    taskId: string,
  ): AsyncGenerator<
    | TaskStatusUpdateEvent
    | TaskArtifactUpdateEvent
    | { kind: 'task'; task: Task }
    | { kind: 'message'; message: Message }
  > {
    await this.assertStreamingSupported();

    const response = await this.fetch(`${this.options.baseUrl}/tasks/${taskId}/subscribe`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });

    if (!response.ok) {
      throw new A2AError('HTTPError', `HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new A2AError('HTTPError', 'No response body for SSE stream');
    }

    yield* this.parseSseStream(response.body);
  }

  private async *parseSseStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<
    | TaskStatusUpdateEvent
    | TaskArtifactUpdateEvent
    | { kind: 'task'; task: Task }
    | { kind: 'message'; message: Message }
  > {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const json = trimmed.slice(5).trimStart();
            let parsed: unknown;
            try {
              parsed = JSON.parse(json);
            } catch {
              throw new InvalidAgentResponseError(`Malformed SSE JSON: ${json}`);
            }
            const validated = SseEventSchema.safeParse(parsed);
            if (!validated.success) {
              throw new InvalidAgentResponseError(`Invalid SSE event: ${validated.error.message}`);
            }
            yield validated.data as
              | TaskStatusUpdateEvent
              | TaskArtifactUpdateEvent
              | { kind: 'task'; task: Task };
          }
        }
      }

      // Process any remaining buffered data
      const remaining = buffer.trim();
      if (remaining.startsWith('data:')) {
        const json = remaining.slice(5).trimStart();
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          throw new InvalidAgentResponseError(`Malformed SSE JSON: ${json}`);
        }
        const validated = SseEventSchema.safeParse(parsed);
        if (!validated.success) {
          throw new InvalidAgentResponseError(`Invalid SSE event: ${validated.error.message}`);
        }
        yield validated.data as
          | TaskStatusUpdateEvent
          | TaskArtifactUpdateEvent
          | { kind: 'task'; task: Task };
      }
    } finally {
      reader.releaseLock();
    }
  }
}
