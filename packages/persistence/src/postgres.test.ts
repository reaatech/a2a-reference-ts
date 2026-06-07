import type { Task } from '@reaatech/a2a-reference-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTaskStore } from './postgres.js';

vi.mock('pg', () => ({ Pool: vi.fn() }));

type MockClient = { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
type MockPool = {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

let mockClient: MockClient;
let mockPool: MockPool;

beforeEach(() => {
  mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn(),
  };
});

function createStore() {
  return new PostgresTaskStore({ pool: mockPool as unknown as import('pg').Pool });
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    context_id: 'ctx-1',
    status_state: 'submitted',
    status_timestamp: '2025-01-01T00:00:00.000Z',
    status_message: null,
    metadata: null,
    principal: 'user-1',
    tenant_id: 'tenant-1',
    history_length: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    task_id: 'task-1',
    role: 'user',
    parts: JSON.stringify([{ kind: 'text', text: 'hello' }]),
    message_id: 'msg-1',
    metadata: null,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function artifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    task_id: 'task-1',
    name: 'result',
    description: 'The result',
    parts: JSON.stringify([{ kind: 'text', text: 'output' }]),
    metadata: null,
    index: 0,
    append: false,
    last_chunk: true,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const fullTask: Task = {
  id: 'task-1',
  contextId: 'ctx-1',
  status: { state: 'submitted', timestamp: '2025-01-01T00:00:00.000Z' },
  principal: 'user-1',
  tenantId: 'tenant-1',
};

// ─── Constructor & Initialization ───────────────────────────────────────────

describe('constructor', () => {
  it('escapes schema name correctly', () => {
    const s = new PostgresTaskStore({
      pool: mockPool as unknown as import('pg').Pool,
      schemaName: 'test"schema',
    });
    const internals = s as unknown as {
      taskTable: string;
      artifactTable: string;
      historyTable: string;
    };
    expect(internals.taskTable).toContain('"test""schema"');
    expect(internals.artifactTable).toContain('"test""schema"');
    expect(internals.historyTable).toContain('"test""schema"');
  });

  it('uses default table prefix when not provided', () => {
    const s = new PostgresTaskStore({ pool: mockPool as unknown as import('pg').Pool });
    const internals = s as unknown as {
      tablePrefix: string;
      taskTable: string;
      artifactTable: string;
      historyTable: string;
    };
    expect(internals.tablePrefix).toBe('a2a');
    expect(internals.taskTable).toContain('"a2a_tasks"');
    expect(internals.artifactTable).toContain('"a2a_artifacts"');
    expect(internals.historyTable).toContain('"a2a_history"');
  });
});

describe('initialize', () => {
  it('creates tables and indexes', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    await createStore().initialize();
    expect(mockClient.query).toHaveBeenCalledTimes(9);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

// ─── create() ────────────────────────────────────────────────────────────────

describe('create', () => {
  it('inserts task row with all fields', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT check
      .mockResolvedValueOnce({ rows: [] }) // INSERT task
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().create(fullTask);

    const calls = mockClient.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[3][0]).toBe('COMMIT');
    const insertSql = calls[2][0] as string;
    expect(insertSql).toContain('INSERT INTO');
    expect(insertSql).toContain('a2a_tasks');
    expect(calls[2][1]).toEqual([
      'task-1',
      'ctx-1',
      'submitted',
      '2025-01-01T00:00:00.000Z',
      null,
      null,
      'user-1',
      'tenant-1',
      null,
    ]);
  });

  it('inserts history rows when task has history', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT check
      .mockResolvedValueOnce({ rows: [] }) // INSERT task
      .mockResolvedValueOnce({ rows: [] }) // INSERT history 1
      .mockResolvedValueOnce({ rows: [] }) // INSERT history 2
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().create({
      ...fullTask,
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'msg-1' },
        { role: 'agent', parts: [{ kind: 'text', text: 'hello' }], messageId: 'msg-2' },
      ],
    });

    expect(mockClient.query).toHaveBeenCalledTimes(6);
    const histInserts = [mockClient.query.mock.calls[3], mockClient.query.mock.calls[4]];
    expect(histInserts[0][1]).toEqual([
      'task-1',
      'user',
      JSON.stringify([{ kind: 'text', text: 'hi' }]),
      'msg-1',
      null,
    ]);
    expect(histInserts[1][1]).toEqual([
      'task-1',
      'agent',
      JSON.stringify([{ kind: 'text', text: 'hello' }]),
      'msg-2',
      null,
    ]);
  });

  it('inserts artifact rows when task has artifacts', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT check
      .mockResolvedValueOnce({ rows: [] }) // INSERT task
      .mockResolvedValueOnce({ rows: [] }) // INSERT artifact 1
      .mockResolvedValueOnce({ rows: [] }) // INSERT artifact 2
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().create({
      ...fullTask,
      artifacts: [
        { name: 'a1', description: 'd1', parts: [{ kind: 'text', text: 'x' }] },
        { name: 'a2', parts: [{ kind: 'text', text: 'y' }] },
      ],
    });

    expect(mockClient.query).toHaveBeenCalledTimes(6);
    const artInserts = [mockClient.query.mock.calls[3], mockClient.query.mock.calls[4]];
    expect(artInserts[0][1]).toContain('a1');
    expect(artInserts[0][1]).toContain(0); // index
    expect(artInserts[1][1]).toContain('a2');
    expect(artInserts[1][1]).toContain(1); // index
  });

  it('throws if task already exists', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] }); // SELECT check

    await expect(createStore().create(fullTask)).rejects.toThrow('Task already exists: task-1');
  });

  it('rolls back on query error', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT check
      .mockRejectedValueOnce(new Error('boom')); // INSERT fails

    await expect(createStore().create(fullTask)).rejects.toThrow('boom');

    const rollbackCall = mockClient.query.mock.calls.find((c) => (c as [string])[0] === 'ROLLBACK');
    expect(rollbackCall).toBeDefined();
  });
});

// ─── get() ───────────────────────────────────────────────────────────────────

describe('get', () => {
  it('returns undefined for missing task', async () => {
    const result = await createStore().get('missing');
    expect(result).toBeUndefined();
  });

  it('returns full task with history and artifacts', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [taskRow()] }) // SELECT task
      .mockResolvedValueOnce({ rows: [historyRow()] }) // SELECT history
      .mockResolvedValueOnce({ rows: [artifactRow()] }); // SELECT artifacts

    const result = await createStore().get('task-1');

    expect(result).toBeDefined();
    expect(result?.id).toBe('task-1');
    expect(result?.contextId).toBe('ctx-1');
    expect(result?.status.state).toBe('submitted');
    expect(result?.principal).toBe('user-1');
    expect(result?.tenantId).toBe('tenant-1');
    expect(result?.history).toHaveLength(1);
    expect(result?.history?.[0].role).toBe('user');
    expect(result?.history?.[0].messageId).toBe('msg-1');
    expect(result?.artifacts).toHaveLength(1);
    expect(result?.artifacts?.[0].name).toBe('result');
  });

  it('applies historyLength option', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [taskRow()] }) // SELECT task
      .mockResolvedValueOnce({
        // SELECT history — 3 rows
        rows: [
          historyRow({ id: 1, message_id: 'msg-1' }),
          historyRow({ id: 2, message_id: 'msg-2', role: 'agent' }),
          historyRow({ id: 3, message_id: 'msg-3' }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // SELECT artifacts

    const result = await createStore().get('task-1', { historyLength: 2 });

    expect(result?.history).toHaveLength(2);
    expect(result?.history?.[0].messageId).toBe('msg-2');
    expect(result?.history?.[1].messageId).toBe('msg-3');
  });

  it('handles nullable and optional fields', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          taskRow({
            context_id: null,
            status_message: JSON.stringify({
              role: 'user',
              parts: [{ kind: 'text', text: 'msg' }],
            }),
            metadata: JSON.stringify({ foo: 'bar' }),
            principal: null,
            tenant_id: null,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createStore().get('task-1');

    expect(result?.contextId).toBeUndefined();
    expect(result?.principal).toBeUndefined();
    expect(result?.tenantId).toBeUndefined();
    expect(result?.status.message).toBeDefined();
    expect((result?.status.message as { role: string }).role).toBe('user');
    expect(result?.metadata).toEqual({ foo: 'bar' });
  });

  it('falls back to generated messageId when history has none', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [taskRow()] })
      .mockResolvedValueOnce({ rows: [historyRow({ message_id: null })] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createStore().get('task-1');
    expect(result?.history?.[0].messageId).toMatch(/^msg-/);
  });
});

// ─── update() ────────────────────────────────────────────────────────────────

describe('update', () => {
  it('updates task fields', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [taskRow()] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [historyRow()] }) // rowToTask: SELECT history
      .mockResolvedValueOnce({ rows: [artifactRow()] }); // rowToTask: SELECT artifacts
    // UPDATE, history/artifact replacement, and COMMIT fall through to default { rows: [] }

    const result = await createStore().update('task-1', {
      principal: 'user-2',
    });

    expect(result).toBeDefined();
    expect(result?.principal).toBe('user-2');
    expect(result?.id).toBe('task-1');

    const updateCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE') && c[0].includes('SET'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[0] as string).toContain('a2a_tasks');
    expect(updateCall?.[1][6]).toBe('user-2');
  });

  it('returns undefined for missing task', async () => {
    // BEGIN then an empty SELECT ... FOR UPDATE → ROLLBACK, undefined
    mockClient.query.mockResolvedValue({ rows: [] });

    const result = await createStore().update('missing', {
      status: { state: 'completed' },
    });
    expect(result).toBeUndefined();
  });

  it('works with function updater', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [taskRow()] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [historyRow()] }) // rowToTask: SELECT history
      .mockResolvedValueOnce({ rows: [artifactRow()] }); // rowToTask: SELECT artifacts

    const result = await createStore().update('task-1', (t: Task) => ({
      ...t,
      status: { ...t.status, state: 'working' as const },
    }));

    expect(result).toBeDefined();
    expect(result?.status.state).toBe('working');
  });
});

// ─── list() ──────────────────────────────────────────────────────────────────

describe('list', () => {
  it('returns all tasks', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '2' }] }) // COUNT
      .mockResolvedValueOnce({ rows: [taskRow({ id: 't1' }), taskRow({ id: 't2' })] }); // SELECT

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // history for t1
      .mockResolvedValueOnce({ rows: [] }) // artifacts for t1
      .mockResolvedValueOnce({ rows: [] }) // history for t2
      .mockResolvedValueOnce({ rows: [] }); // artifacts for t2

    const result = await createStore().list();

    expect(result.tasks).toHaveLength(2);
    expect(result.totalSize).toBe(2);
    expect(result.nextPageToken).toBe('');
  });

  it('returns empty list when no tasks', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createStore().list();
    expect(result.tasks).toHaveLength(0);
    expect(result.totalSize).toBe(0);
    expect(result.nextPageToken).toBe('');
  });

  it('filters by contextId', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [taskRow({ id: 't1', context_id: 'ctx-1' })] });

    mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await createStore().list({ contextId: 'ctx-1' });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('t1');
    const countSql = mockPool.query.mock.calls[0][0] as string;
    expect(countSql).toContain('WHERE');
    expect(countSql).toContain('context_id');
  });

  it('filters by status', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [taskRow({ id: 't1', status_state: 'completed' })] });

    mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await createStore().list({ status: 'completed' });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].status.state).toBe('completed');
  });

  it('paginates correctly', async () => {
    const manyRows = Array.from({ length: 5 }, (_, i) => taskRow({ id: `t${i + 1}` }));

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '5' }] }) // COUNT
      .mockResolvedValueOnce({ rows: manyRows.slice(0, 2) }); // SELECT LIMIT 2

    // 2 tasks * 2 queries each = 4
    for (let i = 0; i < 2; i++) {
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // history
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // artifacts
    }

    const result = await createStore().list({ pageSize: 2, pageToken: '0' });

    expect(result.tasks).toHaveLength(2);
    expect(result.totalSize).toBe(5);
    expect(result.nextPageToken).toBe('1');
  });

  it('returns empty nextPageToken on last page', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [taskRow({ id: 't1' }), taskRow({ id: 't2' })] });

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createStore().list({ pageSize: 5, pageToken: '0' });

    expect(result.nextPageToken).toBe('');
  });
});

// ─── cancel() ────────────────────────────────────────────────────────────────

describe('cancel', () => {
  it('cancels a task in non-terminal state', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [taskRow({ status_state: 'working' })] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE to canceled
      // internal get() after cancel
      .mockResolvedValueOnce({ rows: [taskRow({ status_state: 'canceled' })] }) // SELECT task
      .mockResolvedValueOnce({ rows: [] }) // SELECT history
      .mockResolvedValueOnce({ rows: [] }); // SELECT artifacts

    const result = await createStore().cancel('task-1');

    expect(result).toBeDefined();
    expect(result?.status.state).toBe('canceled');
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0] as string).toContain('UPDATE');
    expect(updateCall[0] as string).toContain("status_state = 'canceled'");
  });

  it('returns undefined for terminal state', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [taskRow({ status_state: 'completed' })] }); // SELECT

    const result = await createStore().cancel('task-1');
    expect(result).toBeUndefined();
  });

  it('returns undefined for missing task', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT — empty

    const result = await createStore().cancel('missing');
    expect(result).toBeUndefined();
  });
});

// ─── addHistory() ────────────────────────────────────────────────────────────

describe('addHistory', () => {
  it('adds history message', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ history_length: null }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // INSERT history
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().addHistory('task-1', {
      messageId: 'msg-10',
      role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
    });

    expect(mockClient.query).toHaveBeenCalledTimes(4);
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0] as string).toContain('INSERT INTO');
    expect(insertCall[0] as string).toContain('a2a_history');
    expect(insertCall[1][1]).toBe('user');
    expect(insertCall[1][2]).toBe(JSON.stringify([{ kind: 'text', text: 'hello' }]));
  });

  it('throws if task not found', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE — empty

    await expect(
      createStore().addHistory('missing', {
        messageId: 'msg-11',
        role: 'user',
        parts: [{ kind: 'text', text: 'x' }],
      }),
    ).rejects.toThrow('Task not found: missing');
  });

  it('trims history to historyLength', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ history_length: 2 }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // INSERT history
      .mockResolvedValueOnce({ rows: [] }) // DELETE old history
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().addHistory('task-1', {
      messageId: 'msg-12',
      role: 'agent',
      parts: [{ kind: 'text', text: 'response' }],
    });

    expect(mockClient.query).toHaveBeenCalledTimes(5);
    const deleteCall = mockClient.query.mock.calls[3];
    expect(deleteCall[0] as string).toContain('DELETE');
    expect(deleteCall[1]).toEqual(['task-1', 2]);
  });

  it('trims with history_length 0 (deletes all)', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ history_length: 0 }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // INSERT history
      .mockResolvedValueOnce({ rows: [] }) // DELETE with LIMIT 0 → deletes all
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().addHistory('task-1', {
      messageId: 'msg-13',
      role: 'user',
      parts: [{ kind: 'text', text: 'x' }],
    });

    expect(mockClient.query).toHaveBeenCalledTimes(5);
    const deleteCall = mockClient.query.mock.calls[3];
    expect(deleteCall[1]).toEqual(['task-1', 0]);
  });

  it('rolls back on error and rethrows', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('select fail')); // SELECT FOR UPDATE fails

    await expect(
      createStore().addHistory('task-1', {
        messageId: 'msg-14',
        role: 'user',
        parts: [{ kind: 'text', text: 'x' }],
      }),
    ).rejects.toThrow('select fail');

    const rollbackCall = mockClient.query.mock.calls.find((c) => (c as [string])[0] === 'ROLLBACK');
    expect(rollbackCall).toBeDefined();
  });
});

// ─── addArtifact() ───────────────────────────────────────────────────────────

describe('addArtifact', () => {
  it('adds artifact with correct index', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ next_index: 5 }] }) // SELECT MAX(index) + 1
      .mockResolvedValueOnce({ rows: [] }) // INSERT artifact
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().addArtifact('task-1', {
      name: 'result',
      description: 'Final output',
      parts: [{ kind: 'text', text: 'done' }],
    });

    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[1][5]).toBe(5); // index param
    expect(mockClient.query).toHaveBeenCalledTimes(4);
  });

  it('inserts with index 0 when no prior artifacts', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ next_index: 0 }] }) // SELECT MAX(index) + 1 (no rows → COALESCE gives 0)
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createStore().addArtifact('task-1', {
      parts: [{ kind: 'text', text: 'first' }],
    });

    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[1][5]).toBe(0);
  });

  it('rolls back on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ next_index: 1 }] }) // SELECT MAX
      .mockRejectedValueOnce(new Error('insert fail')); // INSERT fails

    await expect(
      createStore().addArtifact('task-1', {
        parts: [{ kind: 'text', text: 'oops' }],
      }),
    ).rejects.toThrow('insert fail');

    const rollbackCall = mockClient.query.mock.calls.find((c) => (c as [string])[0] === 'ROLLBACK');
    expect(rollbackCall).toBeDefined();
  });
});

// ─── updateStatus() ──────────────────────────────────────────────────────────

describe('updateStatus', () => {
  it('updates task status', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    await createStore().updateStatus('task-1', {
      state: 'working',
      timestamp: '2025-06-01T00:00:00.000Z',
    });

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE');
    expect(sql).toContain('a2a_tasks');
    expect(sql).toContain('status_state');
    expect(mockPool.query.mock.calls[0][1]).toEqual([
      'task-1',
      'working',
      '2025-06-01T00:00:00.000Z',
      null,
    ]);
  });

  it('throws if task not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

    await expect(createStore().updateStatus('missing', { state: 'completed' })).rejects.toThrow(
      'Task not found: missing',
    );
  });
});

// ─── rowToTask (via get) ─────────────────────────────────────────────────────

describe('rowToTask', () => {
  it('parses JSONB string fields correctly', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          taskRow({
            status_message: JSON.stringify({
              role: 'user',
              parts: [{ kind: 'text', text: 'status msg' }],
            }),
            metadata: JSON.stringify({ key: 'value', nested: { a: 1 } }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          historyRow({
            parts: JSON.stringify([{ kind: 'text', text: 'hist' }]),
            metadata: JSON.stringify({ source: 'user' }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          artifactRow({
            parts: JSON.stringify([{ kind: 'text', text: 'art' }]),
            metadata: JSON.stringify({ version: 2 }),
          }),
        ],
      });

    const result = await createStore().get('task-1');

    expect(result?.status.message).toBeDefined();
    expect((result?.status.message as { role: string }).role).toBe('user');
    expect(result?.metadata).toEqual({ key: 'value', nested: { a: 1 } });
    expect(result?.history?.[0].metadata).toEqual({ source: 'user' });
    expect(result?.artifacts?.[0].metadata).toEqual({ version: 2 });
  });

  it('defaults invalid status state to failed', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [taskRow({ status_state: 'bogus-state' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createStore().get('task-1');
    expect(result?.status.state).toBe('failed');
  });

  it('returns undefined when row has no id', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [taskRow({ id: null })] });

    const result = await createStore().get('task-1');
    expect(result).toBeUndefined();
  });

  it('handles empty history and artifacts', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [taskRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createStore().get('task-1');
    expect(result?.history).toBeUndefined();
    expect(result?.artifacts).toBeUndefined();
  });
});

// ─── close() ─────────────────────────────────────────────────────────────────

describe('close', () => {
  it('ends the pool', async () => {
    await createStore().close();
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});
