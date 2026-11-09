# Boardline agent guide

Read the relevant rule in `.cursor/rules/` before changing code. Keep this file short; detailed
decisions live in `docs/`.

## Product contract

- Complete the recruitment brief before adding bonus scope.
- Preserve the four statuses: `todo`, `in_progress`, `review`, `completed`.
- Demo mode must remain usable without secrets, OAuth, or network access.
- Cloud mode must use Supabase Auth and RLS; never expose a secret/service-role key.
- Prefer clear student-team language over generic SaaS copy.

## Quality gates

Run `npm run check` before handoff. For UI changes, verify 375 px and desktop widths, keyboard
focus, reduced motion, empty states, and drag/drop persistence. For schema changes, create a new
Supabase migration and review every exposed table's RLS policies.

## Reference map

- `docs/ARCHITECTURE.md` — data flow and implementation decisions
- `docs/DESIGN_SYSTEM.md` — visual direction and UI constraints
- `supabase/migrations/` — source of truth for database structure
- `.agents/skills/` — project-pinned UI, testing, and Supabase skills
