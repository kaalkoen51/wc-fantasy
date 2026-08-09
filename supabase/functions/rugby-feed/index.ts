// Server-side proxy for the rugby union stats feed.
//
// Sibling of ../api-football. It exists for different reasons, though, because
// this feed needs no key at all:
//
//   1. The CSP. `connect-src` already allows this Supabase project, so routing
//      through here means the browser never talks to a new host and the policy
//      does not have to be widened. Widening it is the kind of change that is
//      easy to make and hard to take back.
//   2. One place to be polite in. The feed is undocumented and its rate limits
//      are unknown, so a round's worth of match-detail calls is throttled here
//      rather than in every caller.
//   3. Somewhere to put a key later. This appears to be a broadcast-partner
//      endpoint accessed directly rather than a public product. If it starts
//      demanding a token or restricting origins, this file changes and nothing
//      else does.
//
// Deploy once per project:
//   supabase functions deploy rugby-feed
//
// NOTE the host below. There is a second, unrelated product on the same
// platform called "Players & Teams" at players.cortextech.io, which is a
// headless CMS for editorial player profiles -- bios, photos, social links.
// It is NOT this feed and must never be substituted for it.

const HOST = "https://rugby-union-feeds.incrowdsports.com";

/* Only the shapes the app actually asks for, so a leaked anon key cannot turn
   this into an open relay for someone else's feed. `matches/{id}` and
   `teams/{id}/players` carry an id, so they are matched as patterns rather
   than by set membership -- and the id is required to be digits, which is what
   stops `matches/../../whatever` from being a path at all. */
const ALLOWED: RegExp[] = [
  /^matches\/search$/,
  /^matches\/\d+$/,
  /^teams\/\d+\/players$/,
  /^teams\/\d+$/,
];

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

/* The feed's own error shape, so a caller can treat "no such match" the same
   way whether it came from upstream or from here. It answers 200 with
   {"status":"error"} rather than an HTTP error, which is worth knowing. */
const feedError = (message: string, status: number) =>
  json({ message, status: "error" }, status);

/* Unknown rate limits and no published policy, so calls are spaced. This is a
   per-instance floor rather than a real limiter: edge functions scale out, so
   it cannot promise a global rate. It is enough to stop one client looping a
   round's 6-8 fixtures back-to-back, which is the case the guide warns about. */
const MIN_GAP_MS = 250;
let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const path = (url.searchParams.get("path") || "").replace(/^\/+/, "");
  if (!ALLOWED.some((re) => re.test(path))) {
    return feedError(`Unsupported path: ${path}`, 400);
  }

  const target = new URL(`${HOST}/v1/${path}`);
  for (const [k, v] of url.searchParams) if (k !== "path") target.searchParams.set(k, v);
  // Required on every request; set here so no caller can forget it.
  target.searchParams.set("provider", "rugbyviz");

  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  try {
    const resp = await fetch(target, { cache: "no-store" });
    return new Response(await resp.text(), {
      status: resp.status,
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return feedError(`Upstream request failed: ${(e as Error).message}`, 502);
  }
});
