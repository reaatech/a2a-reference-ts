import { describe, expect, it } from 'vitest';
import { JsonRpcRequestSchema, JsonRpcRouter } from './json-rpc.js';

describe('JsonRpcRequestSchema', () => {
  it('validates a correct request', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'tasks/send',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing jsonrpc', () => {
    const result = JsonRpcRequestSchema.safeParse({ method: 'tasks/send' });
    expect(result.success).toBe(false);
  });
});

describe('JsonRpcRouter', () => {
  it('routes a registered method', async () => {
    const router = new JsonRpcRouter();
    router.register('ping', async () => 'pong');
    const response = await router.handle({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(response.result).toBe('pong');
    expect(response.error).toBeUndefined();
  });

  it('returns method not found for unregistered method', async () => {
    const router = new JsonRpcRouter();
    const response = await router.handle({ jsonrpc: '2.0', id: 1, method: 'missing' });
    expect(response.error?.code).toBe(-32601);
  });

  it('returns parse error for invalid jsonrpc', async () => {
    const router = new JsonRpcRouter();
    const response = await router.handle({ method: 'ping' });
    expect(response.error?.code).toBe(-32700);
  });

  it('returns internal error for thrown exceptions', async () => {
    const router = new JsonRpcRouter();
    router.register('fail', async () => {
      throw new Error('boom');
    });
    const response = await router.handle({ jsonrpc: '2.0', id: 1, method: 'fail' });
    expect(response.error?.code).toBe(-32603);
    expect(response.error?.message).toContain('boom');
  });

  it('handles notification-style requests without id', async () => {
    const router = new JsonRpcRouter();
    router.register('notify', async () => 'ok');
    const response = await router.handle({ jsonrpc: '2.0', method: 'notify' });
    expect(response.id).toBeNull();
    expect(response.result).toBe('ok');
  });
});
