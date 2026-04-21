import { describe, expect, it } from 'vitest';
import {
  A2AError,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from './errors.js';

describe('A2AError', () => {
  it('creates with code and message', () => {
    const err = new A2AError('TestError', 'something failed', { extra: true });
    expect(err.code).toBe('TestError');
    expect(err.message).toBe('something failed');
    expect(err.details).toEqual({ extra: true });
    expect(err.name).toBe('A2AError');
  });

  it('subclass errors have correct names', () => {
    const err = new TaskNotFoundError('task-1');
    expect(err.name).toBe('TaskNotFoundError');
  });

  it('TaskNotFoundError has correct code', () => {
    const err = new TaskNotFoundError('task-1');
    expect(err.code).toBe('TaskNotFoundError');
    expect(err.message).toContain('task-1');
  });

  it('TaskNotCancelableError has correct code', () => {
    const err = new TaskNotCancelableError('task-1');
    expect(err.code).toBe('TaskNotCancelableError');
    expect(err.message).toContain('task-1');
  });

  it('PushNotificationNotSupportedError has correct code', () => {
    const err = new PushNotificationNotSupportedError();
    expect(err.code).toBe('PushNotificationNotSupportedError');
  });

  it('UnsupportedOperationError has correct code', () => {
    const err = new UnsupportedOperationError('stream');
    expect(err.code).toBe('UnsupportedOperationError');
    expect(err.message).toContain('stream');
  });

  it('ContentTypeNotSupportedError has correct code', () => {
    const err = new ContentTypeNotSupportedError('image/webp');
    expect(err.code).toBe('ContentTypeNotSupportedError');
    expect(err.message).toContain('image/webp');
  });

  it('InvalidAgentResponseError has correct code', () => {
    const err = new InvalidAgentResponseError('bad json');
    expect(err.code).toBe('InvalidAgentResponseError');
    expect(err.message).toBe('bad json');
  });

  it('ExtendedAgentCardNotConfiguredError has correct code', () => {
    const err = new ExtendedAgentCardNotConfiguredError();
    expect(err.code).toBe('ExtendedAgentCardNotConfiguredError');
  });

  it('ExtensionSupportRequiredError has correct code', () => {
    const err = new ExtensionSupportRequiredError('geo');
    expect(err.code).toBe('ExtensionSupportRequiredError');
    expect(err.message).toContain('geo');
  });

  it('VersionNotSupportedError has correct code', () => {
    const err = new VersionNotSupportedError('0.1');
    expect(err.code).toBe('VersionNotSupportedError');
    expect(err.message).toContain('0.1');
  });
});
