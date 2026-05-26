# @reaatech/a2a-reference-persistence

## 0.2.0

### Minor Changes

- [#18](https://github.com/reaatech/a2a-reference-ts/pull/18) [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4) Thanks [@reaatech](https://github.com/reaatech)! - Add `PostgresTaskStore`. Support principal-scoped `list()` across all stores so `tasks/list` totals and pagination respect the caller. Make `PostgresTaskStore.update()` transactional and persist history/artifacts.

### Patch Changes

- Updated dependencies [[`336fc6e`](https://github.com/reaatech/a2a-reference-ts/commit/336fc6e142d8b62ab7bc84e76552818c24f0104b), [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4), [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4)]:
  - @reaatech/a2a-reference-observability@0.2.0
  - @reaatech/a2a-reference-core@0.2.0
