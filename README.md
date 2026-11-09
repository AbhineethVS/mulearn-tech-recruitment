# Boardline

Boardline is a focused project-management app built for MuLearn CET Tech Team Recruitment Task 04.
Users can register or log in, manage projects and tasks, drag work through a four-column Kanban
board, and understand progress from a responsive dashboard.

## Try the demo

```text
Email: demo@boardline.app
Password: boardline2026
```

The login form is already filled in. Demo data persists in the current browser, so reviewers can
create, edit, delete, filter, and move work without connecting a social account or waiting for
email confirmation.

## Features

- Email/password authentication through Supabase
- Zero-setup local demo workspace
- Project and task CRUD
- To do, In progress, Review, and Completed Kanban columns
- Persisted drag-and-drop status changes
- Priority filtering and task search
- Total, completed, pending, and overdue metrics
- Accessible Recharts status visualization
- Responsive sidebar, forms, dashboard, and horizontal mobile Kanban
- Row-level security, indexed queries, and Realtime-ready tables

## Stack

React 19, TypeScript, Vite, Supabase, dnd-kit, Recharts, Lucide, and Vitest.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

The demo works even if `.env.local` is omitted.

To enable cloud accounts, set:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Use only a publishable key in the browser. Never place a Supabase secret or service-role key in a
`VITE_` variable.

## Database setup

Install Docker and the Supabase CLI, then run:

```bash
npx supabase start
npx supabase db reset
```

For an existing hosted project:

```bash
npx supabase link --project-ref your-project-ref
npx supabase db push
```

The migration in `supabase/migrations/` creates profiles, projects, tasks, enums, indexes, update
triggers, Auth profile provisioning, RLS policies, API grants, and Realtime publication entries.

## Quality checks

```bash
npm run check
```

This runs linting, TypeScript, unit tests, and a production build.

## Project guide

- `AGENTS.md` — short operating guide for coding agents and reviewers
- `.cursor/rules/` — product, UI, and Supabase invariants
- `.agents/skills/` — pinned UI, web testing, and Supabase guidance
- `docs/ARCHITECTURE.md` — runtime modes, data flow, and trade-offs
- `docs/DESIGN_SYSTEM.md` — visual system and accessibility floor
- `wireframes/` — original product-flow wireframe

## Design rationale

The interface follows the supplied references without copying them: a compact left rail, quiet
working canvas, readable task cards, and color used for state rather than decoration. The final
palette avoids the familiar teal-on-white generated-dashboard look.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
