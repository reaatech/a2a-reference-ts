export class A2AError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class TaskNotFoundError extends A2AError {
  constructor(taskId: string) {
    super('TaskNotFoundError', `Task not found: ${taskId}`);
  }
}

export class TaskNotCancelableError extends A2AError {
  constructor(taskId: string) {
    super('TaskNotCancelableError', `Task is not in a cancelable state: ${taskId}`);
  }
}

export class PushNotificationNotSupportedError extends A2AError {
  constructor() {
    super(
      'PushNotificationNotSupportedError',
      'Push notifications are not supported by this agent',
    );
  }
}

export class UnsupportedOperationError extends A2AError {
  constructor(operation: string) {
    super('UnsupportedOperationError', `Operation not supported: ${operation}`);
  }
}

export class ContentTypeNotSupportedError extends A2AError {
  constructor(contentType: string) {
    super('ContentTypeNotSupportedError', `Content type not supported: ${contentType}`);
  }
}

export class InvalidAgentResponseError extends A2AError {
  constructor(message: string) {
    super('InvalidAgentResponseError', message);
  }
}

export class ExtendedAgentCardNotConfiguredError extends A2AError {
  constructor() {
    super('ExtendedAgentCardNotConfiguredError', 'Extended agent card is not configured');
  }
}

export class ExtensionSupportRequiredError extends A2AError {
  constructor(extension: string) {
    super('ExtensionSupportRequiredError', `Extension support required: ${extension}`);
  }
}

export class VersionNotSupportedError extends A2AError {
  constructor(version: string) {
    super('VersionNotSupportedError', `Protocol version not supported: ${version}`);
  }
}
