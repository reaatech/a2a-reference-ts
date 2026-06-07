import type { Artifact, Message, Task, TaskStatus } from '@reaatech/a2a-reference-core';
import { A2AError, TaskNotFoundError } from '@reaatech/a2a-reference-core';
import { defaultLogger } from '@reaatech/a2a-reference-observability';
import type { Pool, PoolClient } from 'pg';
import { applyHistoryLength } from './shared.js';
import type { TaskStore } from './store.js';

/**
 * Options for {@link PostgresTaskStore}.
 *
 * Both `tablePrefix` and `schemaName` are validated against SQL injection
 * by escaping double-quote characters (`"` → `""`) before interpolation into
 * quoted identifiers.
 */
export interface PostgresTaskStoreOptions {
  pool: Pool;
  tablePrefix?: string;
  schemaName?: string;
}

const DEFAULT_TABLE_PREFIX = 'a2a';

export class PostgresTaskStore implements TaskStore {
  private pool: Pool;
  private schemaName: string;
  private tablePrefix: string;
  private taskTable: string;
  private artifactTable: string;
  private historyTable: string;

  constructor(options: PostgresTaskStoreOptions) {
    this.pool = options.pool;
    this.schemaName = options.schemaName ?? 'public';
    this.tablePrefix = (options.tablePrefix ?? DEFAULT_TABLE_PREFIX).replace(/"/g, '""');
    const escapedSchema = this.schemaName.replace(/"/g, '""');
    this.taskTable = `"${escapedSchema}"."${this.tablePrefix}_tasks"`;
    this.artifactTable = `"${escapedSchema}"."${this.tablePrefix}_artifacts"`;
    this.historyTable = `"${escapedSchema}"."${this.tablePrefix}_history"`;
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS "${this.schemaName.replace(/"/g, '""')}";
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.taskTable} (
          id TEXT PRIMARY KEY,
          context_id TEXT,
          status_state TEXT NOT NULL,
          status_timestamp TIMESTAMPTZ,
          status_message JSONB,
          metadata JSONB,
          principal TEXT,
          tenant_id TEXT,
          history_length INT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.historyTable} (
          id SERIAL PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES ${this.taskTable}(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          parts JSONB NOT NULL,
          message_id TEXT,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "idx_${this.tablePrefix}_history_task_id"
        ON ${this.historyTable} (task_id);
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.artifactTable} (
          id SERIAL PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES ${this.taskTable}(id) ON DELETE CASCADE,
          name TEXT,
          description TEXT,
          parts JSONB NOT NULL,
          metadata JSONB,
          index INT NOT NULL DEFAULT 0,
          append BOOLEAN NOT NULL DEFAULT FALSE,
          last_chunk BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "idx_${this.tablePrefix}_artifact_task_id"
        ON ${this.artifactTable} (task_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "idx_${this.tablePrefix}_tasks_status"
        ON ${this.taskTable} (status_state);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "idx_${this.tablePrefix}_tasks_context"
        ON ${this.taskTable} (context_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "idx_${this.tablePrefix}_tasks_principal"
        ON ${this.taskTable} (principal);
      `);
    } finally {
      client.release();
    }
  }

  async create(task: Task): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingCheck = await client.query(`SELECT id FROM ${this.taskTable} WHERE id = $1`, [
        task.id,
      ]);
      if (existingCheck.rows.length > 0) {
        throw new A2AError('TaskAlreadyExistsError', `Task already exists: ${task.id}`);
      }

      await client.query(
        `INSERT INTO ${this.taskTable} (id, context_id, status_state, status_timestamp, status_message, metadata, principal, tenant_id, history_length)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          task.id,
          task.contextId ?? null,
          task.status.state,
          task.status.timestamp ?? null,
          task.status.message ? JSON.stringify(task.status.message) : null,
          task.metadata ? JSON.stringify(task.metadata) : null,
          task.principal ?? null,
          task.tenantId ?? null,
          task.historyLength ?? null,
        ],
      );

      if (task.history) {
        for (const message of task.history) {
          await client.query(
            `INSERT INTO ${this.historyTable} (task_id, role, parts, message_id, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              task.id,
              message.role,
              JSON.stringify(message.parts),
              message.messageId ?? null,
              message.metadata ? JSON.stringify(message.metadata) : null,
            ],
          );
        }
      }

      if (task.artifacts) {
        for (let i = 0; i < task.artifacts.length; i++) {
          const artifact = task.artifacts[i];
          await client.query(
            `INSERT INTO ${this.artifactTable} (task_id, name, description, parts, metadata, index, append, last_chunk)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              task.id,
              artifact.name ?? null,
              artifact.description ?? null,
              JSON.stringify(artifact.parts),
              artifact.metadata ? JSON.stringify(artifact.metadata) : null,
              i,
              false,
              true,
            ],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async get(id: string, options?: { historyLength?: number }): Promise<Task | undefined> {
    const client = await this.pool.connect();
    try {
      const taskRow = await client.query(`SELECT * FROM ${this.taskTable} WHERE id = $1`, [id]);

      if (taskRow.rows.length === 0) return undefined;

      const task = await this.rowToTask(taskRow.rows[0], client, options?.historyLength);
      return task;
    } finally {
      client.release();
    }
  }

  async update(
    id: string,
    updates: Partial<Task> | ((task: Task) => Task),
  ): Promise<Task | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingRow = await client.query(
        `SELECT * FROM ${this.taskTable} WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (existingRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return undefined;
      }
      const existing = await this.rowToTask(existingRow.rows[0], client);
      if (!existing) {
        await client.query('ROLLBACK');
        return undefined;
      }

      const updated =
        typeof updates === 'function' ? updates(existing) : { ...existing, ...updates };

      await client.query(
        `UPDATE ${this.taskTable} SET
           context_id = $2,
           status_state = $3,
           status_timestamp = $4,
           status_message = $5,
           metadata = $6,
           principal = $7,
           tenant_id = $8,
           history_length = $9,
           updated_at = NOW()
         WHERE id = $1`,
        [
          updated.id,
          updated.contextId ?? null,
          updated.status.state,
          updated.status.timestamp ?? null,
          updated.status.message ? JSON.stringify(updated.status.message) : null,
          updated.metadata ? JSON.stringify(updated.metadata) : null,
          updated.principal ?? null,
          updated.tenantId ?? null,
          updated.historyLength ?? null,
        ],
      );

      // Replace history/artifacts so functional updaters that mutate them persist
      // (matches the in-memory store's full-object replacement semantics).
      if (updated.history !== undefined) {
        await client.query(`DELETE FROM ${this.historyTable} WHERE task_id = $1`, [id]);
        for (const message of updated.history) {
          await client.query(
            `INSERT INTO ${this.historyTable} (task_id, role, parts, message_id, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              id,
              message.role,
              JSON.stringify(message.parts),
              message.messageId ?? null,
              message.metadata ? JSON.stringify(message.metadata) : null,
            ],
          );
        }
      }

      if (updated.artifacts !== undefined) {
        await client.query(`DELETE FROM ${this.artifactTable} WHERE task_id = $1`, [id]);
        for (let i = 0; i < updated.artifacts.length; i++) {
          const artifact = updated.artifacts[i];
          await client.query(
            `INSERT INTO ${this.artifactTable} (task_id, name, description, parts, metadata, index, append, last_chunk)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              artifact.name ?? null,
              artifact.description ?? null,
              JSON.stringify(artifact.parts),
              artifact.metadata ? JSON.stringify(artifact.metadata) : null,
              i,
              false,
              true,
            ],
          );
        }
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(options?: {
    contextId?: string;
    status?: string;
    principal?: string;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
  }): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (options?.contextId) {
      conditions.push(`context_id = $${paramIndex++}`);
      params.push(options.contextId);
    }
    if (options?.status) {
      conditions.push(`status_state = $${paramIndex++}`);
      params.push(options.status);
    }
    if (options?.principal) {
      conditions.push(`principal = $${paramIndex++}`);
      params.push(options.principal);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM ${this.taskTable} ${whereClause}`,
      params,
    );
    const totalSize = Number.parseInt(countResult.rows[0].total, 10);

    const pageSize = options?.pageSize ?? 50;
    const pageOffset = options?.pageToken ? Number.parseInt(options.pageToken, 10) * pageSize : 0;
    if (Number.isNaN(pageOffset)) {
      throw new A2AError('InvalidPageTokenError', 'invalid pageToken');
    }

    const taskRows = await this.pool.query(
      `SELECT * FROM ${this.taskTable} ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, pageSize, pageOffset],
    );

    const client = await this.pool.connect();
    let tasks: Task[];
    try {
      tasks = [];
      for (const row of taskRows.rows) {
        const task = await this.rowToTask(row, client, options?.historyLength);
        if (task) tasks.push(task);
      }
    } finally {
      client.release();
    }

    const nextPageToken =
      pageOffset + pageSize < totalSize ? String(pageOffset / pageSize + 1) : '';

    return { tasks, nextPageToken, totalSize };
  }

  async cancel(id: string): Promise<Task | undefined> {
    const client = await this.pool.connect();
    try {
      const taskRow = await client.query(`SELECT * FROM ${this.taskTable} WHERE id = $1`, [id]);
      if (taskRow.rows.length === 0) return undefined;

      const terminalStates = ['completed', 'failed', 'canceled', 'rejected'];
      if (terminalStates.includes(taskRow.rows[0].status_state)) {
        return undefined;
      }

      const now = new Date().toISOString();
      await client.query(
        `UPDATE ${this.taskTable} SET status_state = 'canceled', status_timestamp = $2, updated_at = NOW() WHERE id = $1`,
        [id, now],
      );

      const task = await this.get(id);
      return task;
    } finally {
      client.release();
    }
  }

  async addHistory(id: string, message: Message): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const taskRow = await client.query(
        `SELECT history_length FROM ${this.taskTable} WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (taskRow.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new TaskNotFoundError(id);
      }

      await client.query(
        `INSERT INTO ${this.historyTable} (task_id, role, parts, message_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          message.role,
          JSON.stringify(message.parts),
          message.messageId ?? null,
          message.metadata ? JSON.stringify(message.metadata) : null,
        ],
      );

      const rawLength = taskRow.rows[0].history_length;
      if (rawLength !== null && typeof rawLength === 'number' && rawLength >= 0) {
        await client.query(
          `DELETE FROM ${this.historyTable}
           WHERE task_id = $1
           AND id NOT IN (
             SELECT id FROM ${this.historyTable}
             WHERE task_id = $1
             ORDER BY id DESC
             LIMIT $2
           )`,
          [id, rawLength],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async addArtifact(id: string, artifact: Artifact): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const maxIndex = await client.query(
        `SELECT COALESCE(MAX(index), -1) + 1 as next_index FROM ${this.artifactTable} WHERE task_id = $1`,
        [id],
      );

      await client.query(
        `INSERT INTO ${this.artifactTable} (task_id, name, description, parts, metadata, index, append, last_chunk)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          artifact.name ?? null,
          artifact.description ?? null,
          JSON.stringify(artifact.parts),
          artifact.metadata ? JSON.stringify(artifact.metadata) : null,
          maxIndex.rows[0].next_index,
          false,
          true,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.taskTable} SET status_state = $2, status_timestamp = $3, status_message = $4, updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        status.state,
        status.timestamp ?? null,
        status.message ? JSON.stringify(status.message) : null,
      ],
    );
    if (result.rowCount === 0) {
      throw new TaskNotFoundError(id);
    }
  }

  private async rowToTask(
    row: Record<string, unknown>,
    maybeClient: PoolClient | undefined,
    historyLength?: number,
  ): Promise<Task | undefined> {
    if (typeof row.id !== 'string' || !row.id) return undefined;

    const client = maybeClient ?? (await this.pool.connect());
    const shouldRelease = !maybeClient;

    try {
      const historyRows = await client.query(
        `SELECT * FROM ${this.historyTable} WHERE task_id = $1 ORDER BY id ASC`,
        [row.id],
      );
      const artifactRows = await client.query(
        `SELECT * FROM ${this.artifactTable} WHERE task_id = $1 ORDER BY index ASC`,
        [row.id],
      );

      function parseJsonField(val: unknown): unknown {
        if (typeof val === 'string') {
          try {
            return JSON.parse(val);
          } catch {
            return val;
          }
        }
        return val;
      }

      const history = historyRows.rows
        .filter((h: Record<string, unknown>) => {
          if (typeof h.role === 'string') return true;
          defaultLogger.warn(
            { taskId: row.id, historyEntry: h },
            'history entry dropped: missing or invalid role',
          );
          return false;
        })
        .map((h: Record<string, unknown>) => {
          const parsedParts = parseJsonField(h.parts);
          return {
            messageId:
              typeof h.message_id === 'string' ? h.message_id : `msg-${h.id ?? Date.now()}`,
            role: h.role as 'user' | 'agent',
            parts: (Array.isArray(parsedParts) ? parsedParts : []) as Message['parts'],
            ...(h.metadata
              ? { metadata: parseJsonField(h.metadata) as Record<string, unknown> }
              : {}),
          };
        });

      const artifacts = artifactRows.rows
        .filter((a: Record<string, unknown>) => Array.isArray(parseJsonField(a.parts)))
        .map((a: Record<string, unknown>) => ({
          ...(typeof a.name === 'string' ? { name: a.name } : {}),
          ...(typeof a.description === 'string' ? { description: a.description } : {}),
          parts: parseJsonField(a.parts) as Artifact['parts'],
          ...(a.metadata
            ? { metadata: parseJsonField(a.metadata) as Record<string, unknown> }
            : {}),
        }));

      const statusState = row.status_state;
      const validStates = [
        'submitted',
        'working',
        'input-required',
        'completed',
        'failed',
        'canceled',
        'rejected',
        'auth-required',
      ];
      const state =
        typeof statusState === 'string' && validStates.includes(statusState)
          ? (statusState as Task['status']['state'])
          : 'failed';

      const task: Task = {
        id: row.id as string,
        ...(typeof row.context_id === 'string' ? { contextId: row.context_id } : {}),
        status: {
          state: state as Task['status']['state'],
          ...(typeof row.status_timestamp === 'string' ? { timestamp: row.status_timestamp } : {}),
          ...(row.status_message ? { message: parseJsonField(row.status_message) as Message } : {}),
        },
        ...(history.length > 0 ? { history } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(row.metadata
          ? { metadata: parseJsonField(row.metadata) as Record<string, unknown> }
          : {}),
        ...(typeof row.principal === 'string' ? { principal: row.principal } : {}),
        ...(typeof row.tenant_id === 'string' ? { tenantId: row.tenant_id } : {}),
        ...(typeof row.history_length === 'number' ? { historyLength: row.history_length } : {}),
      };

      return applyHistoryLength(task, historyLength);
    } finally {
      if (shouldRelease) client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
