# FabSQL Builder

**English** | [繁體中文](./README.zh-TW.md)

FabSQL Builder is a visual `SELECT` query builder built with Vue 3,
TypeScript, Fastify, and MariaDB metadata.

The workspace below shows the Schema Explorer and table list on the left,
the relationship diagram in the center, SQL Preview at the bottom, and the
Query Inspector on the right.

![FabSQL Builder workspace](docs/images/fabsql-builder.jpg)

Project status: July 29, 2026. See [WORKLOG.md](./WORKLOG.md) for recent
changes and known limitations.

## Features

- Read table and column metadata from MariaDB.
- Search, expand, and drag items from the Schema Explorer.
- Add tables to the Query Canvas, move nodes, and edit aliases.
- Select output fields directly from table nodes.
- Configure field aliases, aggregate functions, and `DISTINCT`.
- Create a `JOIN` by dragging one `table.field` onto another.
- Display JOIN lines between the exact participating fields.
- Edit `JOIN`, `LEFT JOIN`, and `RIGHT JOIN` direction without guessing from
  foreign keys or column names.
- Preserve the original `JOIN` or `INNER JOIN` spelling and display self
  joins as loops on separate aliases of the same table.
- Build nested `AND` and `OR` filters.
- Configure `GROUP BY`, `ORDER BY`, `LIMIT`, and `OFFSET`.
- Generate formatted MariaDB SQL with separate prepared-statement
  parameters.
- Edit SQL Preview and parse supported SQL back into the visual Query Model.
- Parse functions, arithmetic expressions, `CASE WHEN`, scalar subqueries,
  derived tables, `UNION`, `UNION ALL`, `IN (SELECT ...)`, comments, and
  custom `@parameters`.
- Navigate between the main query, UNION branches, and derived-table
  subqueries from the upper-left canvas navigation.
- Open and edit subquery details.
- Preserve table IDs, node positions, complete schema metadata, comments,
  whitespace, capitalization, and source layout when SQL is saved without
  visual changes.
- Toggle identifier quoting on or off at any time.
- Save custom parameter values with the workspace and restore them on the
  next launch.
- Convert named parameters to prepared-statement `?` parameters only when a
  query is executed.
- Execute read-only Builder queries and preview up to 200 result rows.
- Report Valid, Incomplete, and Cannot compile states.
- Undo and redo changes.
- Download and load versioned Query Model JSON files.
- Autosave the Query Model, selected database, panel sizes, language, theme,
  and other workspace preferences.
- Persist Electron state in the operating system's application data
  directory, with `localStorage` as the browser fallback.
- Clear all saved state for the current runtime.
- Resize the Schema Explorer, Query Inspector, and SQL/Result panel with the
  mouse or keyboard.
- Collapse each resizable panel into a drawer handle and reopen it by
  clicking or dragging the handle.
- Maximize and restore the Query Canvas or SQL/Result panel.
- Pan the entire relationship diagram by dragging empty canvas space with
  the left mouse button.
- Export the complete current query, UNION branch, or subquery diagram to
  PNG, including nodes outside the visible viewport.
- Test and apply MariaDB socket or host/port settings from the environment
  dialog.
- Select exactly one backend mode: built-in Fastify, Laravel JWT API, or
  Laravel ERP session.
- Switch between English, Traditional Chinese, and Simplified Chinese.
- Choose from blue, monochrome, red, and green workspace themes.

MariaDB usernames and passwords remain in the API process and are never sent
back to the frontend. Query execution accepts only a structured Query Model.
The API validates and recompiles that model before executing it inside a
read-only transaction.

Database settings never return the existing password and never write it to
`localStorage`. Settings applied from the UI remain in the current API
process only; after a restart, the API returns to its environment-variable
configuration.

## Editing SQL Preview

Select **Edit** in SQL Preview to switch the generated SQL into a text
editor. While editing, the Schema Explorer, Query Canvas, Query Inspector,
Run command, file commands, undo/redo, and environment switching are locked.

The MariaDB SQL parser is loaded only when the edited SQL is saved. A
successful save creates a new Query Model and updates the relationship
diagram with one history commit. If parsing fails, the draft and the original
Query Model are preserved so the SQL can be corrected or the edit canceled.

The reverse parser currently supports:

- Tables, aliases, selected fields, common aggregate functions, and
  `DISTINCT`.
- `JOIN`, `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, and additional `ON`
  conditions.
- Nested `AND`/`OR`, `NULL`, `IN`, `BETWEEN`, and `IN (SELECT ...)`.
- Functions, literals, arithmetic, comparisons, `CASE WHEN`, and scalar
  subqueries.
- Derived tables, outer-column references, `UNION`, and `UNION ALL`.
- `GROUP BY`, `ORDER BY`, `LIMIT`, `OFFSET`, and custom `@parameters`.

After a successful parse, the original text is stored as `sourceSql`. Until
the visual model is modified, SQL Preview preserves comments, whitespace,
capitalization, and layout. Enabling identifier quoting shows the compiler
version with quoted identifiers; disabling it restores the unquoted source
layout. A visual change invalidates `sourceSql` for that query level and the
compiler then generates the SQL.

Only a read-only SELECT query set is accepted. Non-SELECT statements,
multiple statements, and syntax that cannot be represented by the current
Query Model are rejected. CTEs, `HAVING`, and window functions are not yet in
the verified feature set.

## Custom Parameters and Run

Names such as `@dlvdt` and `@prdno` appear in the collapsed **Custom
Parameters** section below SQL Preview.

- Values are autosaved with the workspace and restored after refresh or
  restart.
- A blank input is executed as an empty string.
- SQL Preview continues to display `@name`; it never inserts the real value
  into the SQL text.
- A Run request sends a named-parameter map.
- The built-in Fastify API recompiles the Query Model and converts every
  supplied value to a `?` parameter in occurrence order.
- Custom parameter values are workspace state and are not included in a
  downloaded Query Model JSON file.

## Project Structure

```text
apps/
  api/
    src/
      database/         MariaDB connection pool
      modules/query/    Read-only query executor and routes
      modules/schema/   INFORMATION_SCHEMA repository and routes
  web/
    src/
      components/       Schema Explorer, Canvas, and Inspector
      preferences/      Language, translation, and theme preferences
      query-builder/    UI state, SQL parser, and drag payloads
      services/         API clients and authentication
packages/
  shared/
    src/
      query-model.ts       Versioned Query Model
      query-validation.ts  Model and MariaDB validation
      query-compiler.ts    Query Model to SQL and parameters
      query-history.ts     Framework-independent undo/redo
```

## Requirements

- Node.js 20 or later
- npm
- MariaDB
- Access to a MariaDB database

The default development configuration uses the local `lysm` database.

## Installation

```bash
npm install
```

## Development

Run the API and web application in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

Default development URLs:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3100`

## Environment Variables

By default, the API connects to MariaDB through `/tmp/mysql.sock` and uses
the `lysm` database. See [.env.example](./.env.example) for overrides.

The API reads schema metadata from `INFORMATION_SCHEMA`. Business data is
queried only when the user selects Run, and the query is executed in a
read-only transaction.

## Backend and Authentication Modes

The environment dialog provides three mutually exclusive modes. The active
mode is shown in the settings sidebar:

1. **Database Connection** uses the built-in Fastify API and an editable
   MariaDB connection.
2. **API Source** uses an external Laravel API with JWT authentication by
   email and password.
3. **Session** uses an external Laravel API and the ERP session that already
   exists in the browser.

Only the selected mode receives requests. Session mode does not implement an
ERP login screen. The user must sign in to the ERP first, and FabSQL requests
include the existing session cookie with `credentials: include`.

The `session` URL parameter can select Session mode and configure its API URL
directly:

```text
https://oa2.jeng-li.com.tw/fabsql/?session=api.jeng-li.com.tw/fabsql
```

If the parameter omits a protocol, the application reuses the current page's
protocol. The example above therefore selects:

```text
https://api.jeng-li.com.tw/fabsql
```

API Source mode retains the `/api` route prefix. Session mode removes that
prefix. For a Session URL of `http://api.jl.test/fabsql`, the frontend calls:

- `GET http://api.jl.test/fabsql/health`
- `GET http://api.jl.test/fabsql/schema/databases`
- `GET http://api.jl.test/fabsql/schema/tables`
- `GET http://api.jl.test/fabsql/schema/tables/{tableName}/columns`
- `POST http://api.jl.test/fabsql/query/run`

The current Laravel 8 integration uses the `jl` database connection and
provides these JWT API routes:

- `GET /api/health`
- `GET /api/schema/databases`
- `GET /api/schema/tables`
- `GET /api/schema/tables/{tableName}/columns`
- `POST /api/query/run`

The Laravel API accepts only a structured Query Model. It validates tables
and columns, compiles parameterized SQL, and executes the query in a
read-only transaction.

`GET /api/health` is public. Database, table, column, and query endpoints
require Laravel JWT authentication. Access tokens are stored only in the
current page's `sessionStorage`. Protected requests include
`Authorization: Bearer <token>`. An expired token is refreshed and retried at
most once; a failed refresh requires a new login.

The Laravel API does not provide public registration. A dedicated user can
be created interactively in the Laravel project so the password is read from
a hidden prompt and does not appear in shell history:

```bash
cd /Users/jimmywon/Herd/api.jl
'/Users/jimmywon/Library/Application Support/Herd/bin/php74' \
  artisan fabsql:create-user you@example.com --name="Your Name"
```

For Session-mode deployment, see the standalone
[Laravel Session Integration Guide](./docs/fabsql-laravel-session-integration-guide.html).

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Production Build

A full build collects Shared, Web, and API output into one `dist` directory:

```text
dist/
  api/          Fastify API
  node_modules/ Production runtime dependencies
  shared/       Query Model, compiler, and validation
  web/          Vue frontend static files
  .env.example
  package.json
  start.mjs
```

Build and start from the project root:

```bash
npm run build
npm start
```

The default production URL is `http://127.0.0.1:3100`. One Fastify
process serves both the frontend and `/api`; Vite Preview is not required.

To deploy the built application elsewhere, copy the complete `dist`
directory. Production dependencies are already installed into
`dist/node_modules`, so the target can start it without another install:

```bash
cd dist
npm start
```

The target still needs Node.js 20 or later and network access to MariaDB.
Dependencies are produced on the build machine. If a native dependency is
added later, the build and target operating systems and CPU architectures
must be compatible.

## Electron Desktop Application

The Electron package includes Chromium, Node.js, Fastify, the MariaDB driver,
and frontend assets. Its main process starts Fastify on a random local port
to avoid conflicting with port `3100`.

Start Electron locally:

```bash
npm run electron:start
```

Package the current platform:

```bash
npm run electron:package
```

Create macOS DMG and ZIP installers:

```bash
npm run electron:make
```

Create a Windows x64 portable ZIP:

```bash
npm run electron:make:windows-x64
```

Create a native Windows ARM64 portable ZIP:

```bash
npm run electron:make:windows-arm64
```

Output is written to `out/`. macOS and Windows artifacts are stored
separately and do not overwrite each other.

Current packages are unsigned. A public release should configure Apple code
signing and notarization for macOS and code signing for Windows.

## Git-Ignored Artifacts

`node_modules/` and `out/` are local artifacts listed in the root
`.gitignore`; they must not be committed or pushed. The same applies to
`dist/`, coverage output, `.env` files, and logs.

Check ignored files before committing:

```bash
git check-ignore node_modules out
git status --ignored -s
```
