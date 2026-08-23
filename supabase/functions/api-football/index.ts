// Server-side API-Football proxy.
//
// Keeps the API key out of the browser so league organisers never have to buy
// and paste their own — one key, held here, serves every league. The client
// (index.html → apiFootball) calls this first and only falls back to a
// user-supplied key if the function isn't deployed.
//
// Deploy once per project:
//   supabase secrets set API_FOOTBALL_KEY=<your key>
//   supabase functions deploy api-football
//
// Only the endpoints the app actually uses are proxied, so a leaked anon key
// can't turn this into an open relay for your API quota.

/* The allowlist is the point of this proxy: the key lives server-side, so
   the set of things the key can be spent on has to be named here rather than
   chosen by whatever calls it.

   Which also means a new caller does not fail loudly. `fixtures/events` was
   added to the app before it was added here, and the rejection came back as
   a 400 that the caller swallows -- so the app quietly scored every match as
   though no events existed, while the Python pull, which talks to the API
   directly, scored them correctly. Two writers disagreeing again, from one
   forgotten line. If you add a path in app.js, add it here in the same
   commit and redeploy the function. */
const ALLOWED = new Set([
  "teams",
  "players/squads",
  "fixtures",
  "fixtures/players",
  "fixtures/events",     // goal minutes + substitutions: who was on the pitch
  /* The competition's own round order. Found by the test described above,
     already broken and already silent: fetchCompetitionRounds has always
     swallowed the rejection and fallen back to sorting rounds by earliest
     kickoff -- which is the inference it was written to replace, because
     moving a knockout tie ahead of a group game reorders the season. */
  "fixtures/rounds",
]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const key = Deno.env.get("API_FOOTBALL_KEY");
  if (!key) return json({ errors: ["API_FOOTBALL_KEY is not set on the server."] }, 500);

  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";
  if (!ALLOWED.has(path)) return json({ errors: [`Unsupported path: ${path}`] }, 400);

  const target = new URL("https://v3.football.api-sports.io/" + path);
  for (const [k, v] of url.searchParams) if (k !== "path") target.searchParams.set(k, v);

  try {
    const resp = await fetch(target, {
      headers: { "x-apisports-key": key },
      // Never serve a cached in-play snapshot for a fixture that has since ended.
      cache: "no-store",
    });
    return new Response(await resp.text(), {
      status: resp.status,
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return json({ errors: [`Upstream request failed: ${(e as Error).message}`] }, 502);
  }
});
