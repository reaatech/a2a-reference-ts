---
"@reaatech/a2a-reference-persistence": minor
---

Add `PostgresTaskStore`. Support principal-scoped `list()` across all stores so `tasks/list` totals and pagination respect the caller. Make `PostgresTaskStore.update()` transactional and persist history/artifacts.
