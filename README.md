# ST Card Register (cloud-synced)

A website to store Maharashtra ST card customer records — name, mobile
number, card number, village, category (Female, Student, Handicapped,
Senior Citizen, Amrut SCT). Add, edit, search, filter, delete. Data lives
in a real database (Supabase), so it's the same on your phone, shop
computer, or any device — updates show up on other open devices within a
few seconds automatically.

## Step 1 — Create a free Supabase project

1. Go to https://supabase.com → sign up (free tier is enough for this).
2. Click "New project." Pick any name and a database password (save it
   somewhere safe), pick a region close to India (e.g. Mumbai/Singapore).
3. Wait ~2 minutes for the project to finish setting up.

## Step 2 — Create the database table

1. In your new project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase_setup.sql` from this folder, copy all of it, paste it
   into the SQL editor, and click **Run**.
3. This creates the `customers` table with the right fields and turns on
   live sync between devices.

## Step 3 — Get your project keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. In this folder, copy `.env.example` to a new file named `.env`, and
   paste your values in:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

## Step 4 — Run it locally (optional, to test)

```
npm install
npm run dev
```
Open the URL shown (usually http://localhost:5173). Add a test customer,
then open the same URL on your phone (same Wi-Fi) or just refresh — it
should now come from Supabase, so any device pointed at this deployed site
will see it.

## Step 5 — Deploy to Vercel (recommended)

1. Push this folder to a GitHub repo (or use Vercel CLI: `npm i -g vercel`
   then run `vercel` from this folder and follow the prompts).
2. On vercel.com → **Add New Project** → import your repo.
3. Before deploying, add the environment variables under
   **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (same values as your `.env` file)
4. Deploy. Vercel auto-detects Vite: build command `npm run build`,
   output directory `dist`.
5. Open the live URL on any device — same data everywhere.

## Step 5 (alternative) — Deploy to Netlify

1. Push to GitHub, then on app.netlify.com → **Add new site → Import an
   existing project** → pick your repo.
2. Build command: `npm run build`, publish directory: `dist`.
3. Under **Site settings → Environment variables**, add the same two
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` values.
4. Deploy.

## Already set up your table before? Run this migration

If you created the `customers` table earlier (before delivered-status
tracking was added), run `add_delivered_column.sql` once in the SQL Editor
to add the new column — it won't touch your existing rows.

## Notes

- **Security**: this setup has no login — anyone with your site's link can
  view and edit records, since the database policy allows open read/write
  for simplicity. That's fine if the link stays private/internal to your
  shop. If you want a simple password gate before the register loads, or
  proper user accounts, let Claude know and this can be added.
- **Card number** must be unique — the database will reject a duplicate.
- If the site shows "Database not connected yet," it means the two
  environment variables aren't set correctly — double check Step 3 (local)
  or Step 5 (deployed).
