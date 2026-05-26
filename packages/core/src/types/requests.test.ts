import { describe, expect, it } from 'vitest';
import {
  CancelTaskRequestSchema,
  GetExtendedAgentCardRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  ListTasksResponseSchema,
  SendMessageRequestSchema,
  SubscribeToTaskRequestSchema,
  TaskPushNotificationConfigSchema,
} from './requests.js';

const validMessage = {
  messageId: 'msg-1',
  role: 'user' as const,
  parts: [{ kind: 'text' as const, text: 'hello' }],
};

describe('SendMessageRequestSchema', () => {
  it('validates a valid send message request', () => {
    const result = SendMessageRequestSchema.safeParse({
      message: validMessage,
    });
    expect(result.success).toBe(true);
  });

  it('validates with optional fields', () => {
    const result = SendMessageRequestSchema.safeParse({
      message: validMessage,
      contextId: 'ctx-1',
      historyLength: 10,
      taskId: 'task-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing message', () => {
    const result = SendMessageRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid message', () => {
    const result = SendMessageRequestSchema.safeParse({
      message: { messageId: 'msg-1' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer historyLength', () => {
    const result = SendMessageRequestSchema.safeParse({
      message: validMessage,
      historyLength: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('GetTaskRequestSchema', () => {
  it('validates with just id', () => {
    const result = GetTaskRequestSchema.safeParse({ id: 'task-1' });
    expect(result.success).toBe(true);
  });

  it('validates with optional historyLength', () => {
    const result = GetTaskRequestSchema.safeParse({
      id: 'task-1',
      historyLength: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = GetTaskRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('ListTasksRequestSchema', () => {
  it('validates an empty request', () => {
    const result = ListTasksRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const result = ListTasksRequestSchema.safeParse({
      contextId: 'ctx-1',
      status: 'completed',
      pageSize: 20,
      pageToken: 'token-abc',
      historyLength: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer pageSize', () => {
    const result = ListTasksRequestSchema.safeParse({ pageSize: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe('ListTasksResponseSchema', () => {
  it('validates a valid response', () => {
    const result = ListTasksResponseSchema.safeParse({
      tasks: [{ id: 'task-1', status: { state: 'completed' } }],
      nextPageToken: '',
      totalSize: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe('CancelTaskRequestSchema', () => {
  it('validates with id', () => {
    const result = CancelTaskRequestSchema.safeParse({ id: 'task-1' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = CancelTaskRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('SubscribeToTaskRequestSchema', () => {
  it('validates with just id', () => {
    const result = SubscribeToTaskRequestSchema.safeParse({ id: 'task-1' });
    expect(result.success).toBe(true);
  });

  it('validates with optional historyLength', () => {
    const result = SubscribeToTaskRequestSchema.safeParse({
      id: 'task-1',
      historyLength: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = SubscribeToTaskRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TaskPushNotificationConfigSchema', () => {
  it('validates with just url', () => {
    const result = TaskPushNotificationConfigSchema.safeParse({
      url: 'https://example.com/callback',
    });
    expect(result.success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const result = TaskPushNotificationConfigSchema.safeParse({
      id: 'notif-1',
      taskId: 'task-1',
      url: 'https://example.com/callback',
      token: 'secret-token',
      authentication: { type: 'bearer' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid url', () => {
    const result = TaskPushNotificationConfigSchema.safeParse({
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing url', () => {
    const result = TaskPushNotificationConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('GetExtendedAgentCardRequestSchema', () => {
  it('validates an empty request', () => {
    const result = GetExtendedAgentCardRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates with tenant', () => {
    const result = GetExtendedAgentCardRequestSchema.safeParse({
      tenant: 'acme-corp',
    });
    expect(result.success).toBe(true);
  });
});
