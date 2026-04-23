# Visual Source of Truth

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

Frontend work often fails in ways that logic tests cannot catch. TaskGoblin treats visual references as first-class verification assets.

## Asset Storage

Assets stay on disk for easy review and Git history:

```txt
docs/assets/<project>/<module>/<task-id>/
  dashboard-empty.png
  login-error-state.png
  invoice-layout.pdf
```

The database stores:

- relative path
- MIME type
- SHA-256 hash
- width and height for images
- page count for PDFs
- owning task and verification item
- expected comparison mode

## Visual Verification Modes

| Mode | Use |
|---|---|
| screenshot | Capture and compare a rendered UI state. |
| pixel-diff | Compare screenshot pixels within a configured tolerance. |
| layout-check | Assert element positions, sizes, and visibility. |
| pdf-render | Render PDF pages and compare snapshots. |
| manual-evidence | Require a captured screenshot for operator review. |

## Approval

Visual assets must be approved before they can serve as source of truth. Updating a source asset requires a new approval because it changes the task's success definition.

