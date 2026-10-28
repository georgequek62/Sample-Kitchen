# Kitchen Planner

Kitchen Planner turns saved weekly orders, stock counts and HR exports into a production plan, reviewed roster, stock request and manager action list.

## What it does

- Validates and stores stock, staff, leave, availability and CRM imports in PostgreSQL.
- Calculates order eligibility, daily production, labour, a named draft roster and whole-pack purchasing needs with deterministic code.
- Runs three bounded OpenAI planning agents only after the owner clicks Run planning agents.
- Shows a manager dashboard with source history, exceptions, stock demand and dated actions.
- Prepares a reviewed Gmail supplier draft through a server-side Zapier MCP connection. The app never sends email or books staff.

## Run locally

1. Copy .env.example to .env.local.
2. Set DATABASE_URL, IMPORT_ADMIN_TOKEN and OPENAI_API_KEY in .env.local.
3. Install dependencies with pnpm install.
4. Generate the client and apply migrations with pnpm db:generate, pnpm prisma migrate deploy and pnpm db:seed.
5. Start the app with pnpm dev.

For Gmail drafts, configure a Zapier MCP server with the Gmail Create Draft action and put its token only in ZAPIER_MCP_TOKEN.

## Deployment

Configure these server-side variables in Vercel:

- DATABASE_URL
- IMPORT_ADMIN_TOKEN
- OPENAI_API_KEY
- ZAPIER_MCP_TOKEN when Gmail drafts are connected

The repository excludes .env.local and operating-data/. The deployed app receives operational records through its owner-only import screen.
