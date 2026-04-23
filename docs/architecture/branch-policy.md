# Branch Policy

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Rule

One task equals one isolated git branch and one verification boundary.

No implementation loop runs directly on the base branch.

## Branch Naming

Default v1 naming:

```txt
tg/<module>/<task-id>-<slug>
```

Examples:

```txt
tg/onboarding/A7-add-status-enum
tg/scheduler/B12-fix-delete-sync
tg/frontend/C3-login-visual-regression
```

If module is unavailable:

```txt
tg/<task-id>-<slug>
```

## Branch States

| State | Meaning |
|---|---|
| `created` | Branch exists but execution has not started. |
| `active` | Executor is currently working on the branch. |
| `dirty` | Branch has uncommitted changes. |
| `verified` | Verification passed on this branch. |
| `approved` | Operator approved the patch. |
| `committed` | Approved patch was committed. |
| `merged` | Branch was merged into base. |
| `abandoned` | Branch is no longer active. |

## Safety Gates

Before any mutating tool call:

- current repository must be a git repository
- task must have an approved verification contract
- task branch must exist
- current branch must match the task branch
- current branch must not be the base branch
- unrelated dirty state must be reported and approved or blocked

## V1 and Later

V1 uses one working tree and normal git branches.

Later versions should support one git worktree per task so multiple tasks can be prepared and tested in parallel without branch switching.

