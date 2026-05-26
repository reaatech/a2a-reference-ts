export function extractScopes(payload: Record<string, unknown>): string[] | undefined {
  const scope = payload.scope;
  if (typeof scope === 'string') {
    return scope.length === 0 ? [] : scope.split(' ');
  }
  if (Array.isArray(scope)) {
    return scope.filter((s): s is string => typeof s === 'string');
  }
  return undefined;
}
