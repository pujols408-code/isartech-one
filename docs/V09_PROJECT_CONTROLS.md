# ISARTECH ONE v0.9 — Project Controls

Production implementation date: 2026-08-28.

## Added controls

- One approved/converted quote can be the source of at most one project.
- Project source references are validated across organization, client, site, contact, opportunity, quote and survey.
- Quote-backed projects only accept APPROVED or CONVERTED quotes.
- Project completion is blocked while any milestone or linked work order remains open.
- Empty projects cannot be completed.
- A successful project completion sets progress to 100% and records `completed_at`.
- Milestone completion timestamps are maintained automatically.
- The operational summary now exposes open/blocked/overdue milestones, open/overdue work orders, days remaining, overdue state and computed health.

## Computed health

The dashboard-ready `computed_health` uses operational signals instead of relying only on a manually selected value:

- `DELAYED`: project target date passed, overdue milestone, or overdue OT.
- `AT_RISK`: blocked milestone, OT waiting for parts/client/review, or less than 80% progress with seven days or fewer remaining.
- `ON_HOLD`: project is on hold.
- `ON_TRACK`: no active risk rule is triggered.

## Edge Function: `project-actions`

JWT verification is enabled. Allowed project-management roles are OWNER, ADMIN, PLANNER and SUPERVISOR.

Supported actions:

- `create_project`
- `update_project`
- `upsert_milestone`
- `delete_milestone`
- `link_work_order`
- `unlink_work_order`
- `change_status`

The function writes sensitive changes to `audit_log`; database triggers continue feeding the unified project timeline in `entity_events`.

## Verification

A production rollback test covered:

1. project creation,
2. pending milestone creation,
3. linking an existing completed OT,
4. attempted project completion rejected because a milestone remained open,
5. milestone completion,
6. successful project completion,
7. progress forced to 100%,
8. computed health returned `ON_TRACK`,
9. transaction rolled back and left no test project, milestone or OT link behind.
