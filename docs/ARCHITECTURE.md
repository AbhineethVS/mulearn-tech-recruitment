# Architecture

## Runtime modes

Boardline deliberately has two data modes:

1. **Demo mode** uses the pre-filled `demo@boardline.app` credentials. Data is seeded and persisted
   in local storage, so an evaluator can exercise every core flow without email confirmation or
   external setup.
2. **Cloud mode** activates when `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` are present. Non-demo credentials use Supabase Auth, and project
   and task mutations use the Data API.

The demo is not a security substitute. Production authorization lives in Postgres RLS.

## Data model

- `profiles` mirrors Auth users and stores display information and role.
- `projects` belongs to one owner and cascades deletion to its tasks.
- `tasks` belongs to a project and owner, with fixed enum values for priority and status.
- Composite indexes support the main board query: project, status, then position.

All exposed tables have RLS. Project and task policies compare `auth.uid()` with `owner_id`.
Task inserts and updates also verify that the referenced project belongs to the caller.

## UI structure

`Boardline.tsx` owns the intentionally small MVP state machine: authentication, active view,
projects, tasks, filters, and mutations. Domain fixtures and types are isolated in `lib/data.ts`;
the optional client is isolated in `lib/supabase.ts`. This keeps the submission easy to explain in
a viva while preserving a clean extraction path to hooks and route modules as scope grows.

## Important trade-offs

- Assignee names are stored with each task for the MVP; `assigned_to` is available for a future
  member picker.
- Demo persistence is browser-local; cloud accounts use the database.
- Dragging changes status and persists it. Fine-grained ordering is represented by `position` and
  can be expanded into within-column sorting later.
