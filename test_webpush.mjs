/* Web Push crypto: what can be proved without a push service.
 *
 * Run: node test_webpush.mjs
 *
 * This imports the SAME .mjs file the edge function imports — not a copy —
 * so what passes here is what ships. WebCrypto is identical in Node and Deno,
 * which is the whole reason that file is plain JavaScript.
 *
 * WHAT THIS CANNOT PROVE, said plainly so nobody reads a green run as more
 * than it is: that Apple or Google accept the result. Nothing offline can.
 * This container is firewalled off from both. These tests prove the payload
 * is self-consistent, that the header block a push service parses has the
 * byte layout the spec describes, and that the VAPID token verifies against
 * the public key we publish. The first real proof is the "Send a test"
 * button, which is why it ships before any trigger does.
 */
import { webcrypto } from "node:crypto";
import {
  b64u, unb64u, encryptPayload, decryptPayload, vapidHeader, audienceOf, sendPush,
  INFO, LAST_RECORD,
} from "./supabase/functions/push-send/webpush.mjs";

const subtle = webcrypto.subtle;
let fails = 0, oks = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else { oks++; console.log(`ok   ${label}`); }
};

// ---- base64url, which every other step depends on -------------------------
check("base64url round-trips arbitrary bytes",
  [...unb64u(b64u(Uint8Array.from([0, 251, 255, 62, 63, 1])))], [0, 251, 255, 62, 63, 1]);
check("base64url uses - and _ and drops padding",
  /^[A-Za-z0-9_-]*$/.test(b64u(Uint8Array.from([255, 254, 253]))), true);

/* The three info strings, byte for byte against the specs.
 *
 * These do not prove the strings are RIGHT — I wrote both sides of the round
 * trip, so a shared misunderstanding survives it. They exist so a later edit
 * cannot drift them silently, and so a reviewer with the RFCs open can check
 * them against the text in one glance. A wrong byte here yields a perfectly
 * valid key the device cannot derive, and the only symptom is a notification
 * that never comes. */
check("RFC 8291 s3.4 key info", INFO.key, "WebPush: info");
check("RFC 8188 s2.2 content-encryption key info", INFO.cek, "Content-Encoding: aes128gcm\0");
check("RFC 8188 s2.2 nonce info", INFO.nonce, "Content-Encoding: nonce\0");
check("the record delimiter is LAST-record, not more-follow", LAST_RECORD, 2);

/* A stand-in for a subscribed phone: a real P-256 keypair and a real 16-byte
   auth secret, in exactly the encoding the browser hands the client. */
async function fakeDevice() {
  const keys = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" },
    true, ["deriveBits"]);
  const raw = new Uint8Array(await subtle.exportKey("raw", keys.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  return { keys, sub: {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    p256dh: b64u(raw), auth: b64u(auth) } };
}

const dev = await fakeDevice();
const MSG = JSON.stringify({ title: "You're on the clock", body: "Round 3, pick 7" });

// ---- the payload ----------------------------------------------------------
{
  const body = await encryptPayload(MSG, dev.sub);
  /* The header block a push service parses before it forwards anything:
     salt(16) | rs(4) | idlen(1) | as_public(65). Asserted by BYTE OFFSET,
     because every one of these is a place where a plausible-looking mistake
     produces a body that only the far end can reject. */
  check("the salt is 16 bytes", body.length >= 21, true);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  check("the record size field is the 4 bytes after the salt", dv.getUint32(16), 4096);
  check("the key-length byte says 65", body[20], 65);
  check("...and an uncompressed point follows it", body[21], 4);
  check("the ciphertext is plaintext + delimiter + GCM tag",
    body.length - 21 - 65, MSG.length + 1 + 16);

  /* The round trip, from the RECEIVER's side of the spec. decryptPayload
     parses the header the way a device does and derives with the roles
     swapped, so a shared misunderstanding would have to be symmetrical to
     survive this. */
  check("a device can decrypt what we send it",
    await decryptPayload(body, dev.keys, dev.sub.auth), MSG);
}

// ---- the things that must NOT be reused ----------------------------------
{
  const a = await encryptPayload(MSG, dev.sub);
  const b = await encryptPayload(MSG, dev.sub);
  /* Same message, same device, twice. If either the salt or the ephemeral
     key were fixed, these would be byte-identical — and reusing a key/nonce
     pair with AES-GCM is the failure that leaks plaintext, not merely a
     tidiness issue. */
  check("two sends of the same message differ", b64u(a) === b64u(b), false);
  check("...because the salt is fresh", b64u(a.slice(0, 16)) === b64u(b.slice(0, 16)), false);
  check("...and so is the ephemeral key",
    b64u(a.slice(21, 86)) === b64u(b.slice(21, 86)), false);
}

// ---- a wrong device must not be able to read it ---------------------------
{
  const other = await fakeDevice();
  const body = await encryptPayload(MSG, dev.sub);
  let threw = false;
  try { await decryptPayload(body, other.keys, dev.sub.auth); } catch { threw = true; }
  check("another device's keys cannot decrypt it", threw, true);
  let threw2 = false;
  try { await decryptPayload(body, dev.keys, b64u(new Uint8Array(16))); } catch { threw2 = true; }
  check("the right keys with the wrong auth secret cannot either", threw2, true);
}

// ---- malformed subscriptions are refused up front -------------------------
{
  const bad = async (sub) => {
    try { await encryptPayload("x", sub); return null; }
    catch (e) { return e.message; }
  };
  check("a truncated p256dh is refused, not encrypted to nothing",
    /uncompressed P-256 point/.test(await bad({ p256dh: b64u(new Uint8Array(32)), auth: b64u(new Uint8Array(16)) })), true);
  check("a wrong-length auth secret is refused",
    /auth secret is 8 bytes/.test(await bad({ p256dh: dev.sub.p256dh, auth: b64u(new Uint8Array(8)) })), true);
}

// ---- VAPID ----------------------------------------------------------------
const fs = await import("node:fs");
const appSrc = fs.readFileSync("app.js", "utf8");
const publicKey = appSrc.match(/VAPID_PUBLIC_KEY\s*=\s*\n?\s*"([^"]+)"/)[1];

/* The published key is checked for SHAPE everywhere, including CI, where the
   private key does not exist -- it is gitignored and lives only in the
   sender's secrets. A truncated or re-wrapped constant is a real way to break
   every subscription at once, and it costs nothing to rule out. */
{
  const raw = unb64u(publicKey);
  check("the published key is an uncompressed P-256 point", [raw.length, raw[0]], [65, 4]);
  check("...and is base64url, not base64",
    /^[A-Za-z0-9_-]+$/.test(publicKey), true);
}

/* A pair generated here, so the JWT itself is tested wherever this runs. */
const testPair = await (async () => {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" },
    true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", kp.privateKey);
  const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64u(raw), privateKey: jwk.d,
           subject: "mailto:admin@draftbaron.com" };
})();

{
  check("the audience is the endpoint's ORIGIN, not the endpoint",
    audienceOf("https://fcm.googleapis.com/fcm/send/abc123?x=1"),
    "https://fcm.googleapis.com");
  check("...including a non-default port, which is part of the origin",
    audienceOf("https://push.example:8443/x/y"), "https://push.example:8443");

  const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
  const hdr = await vapidHeader(dev.sub.endpoint, testPair, NOW);
  check("the header is the vapid scheme with t and k",
    /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(hdr), true);
  check("k is the public key being signed with", hdr.split("k=")[1], testPair.publicKey);

  const [tok] = hdr.slice("vapid t=".length).split(", k=");
  const [h, p, sg] = tok.split(".");
  const dec = (x) => JSON.parse(new TextDecoder().decode(unb64u(x)));
  check("the header says ES256", dec(h), { typ: "JWT", alg: "ES256" });
  const claims = dec(p);
  check("aud is the push service's origin", claims.aud, "https://fcm.googleapis.com");
  check("sub is a contact the service can complain to",
    /^(mailto:|https:)/.test(claims.sub), true);
  /* The spec caps exp at 24 hours and rejects anything already past. 12h
     leaves room for a slow queue without approaching the ceiling. */
  check("exp is 12 hours out, well inside the 24h ceiling",
    claims.exp - Math.floor(NOW / 1000), 12 * 3600);

  const pubRaw = unb64u(testPair.publicKey);
  const vk = await subtle.importKey("jwk",
    { kty: "EC", crv: "P-256", x: b64u(pubRaw.slice(1, 33)), y: b64u(pubRaw.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  check("the token verifies against the key it hands out",
    await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk,
      unb64u(sg), new TextEncoder().encode(`${h}.${p}`)), true);
  check("a tampered claim set does not verify",
    await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk,
      unb64u(sg), new TextEncoder().encode(`${h}.${b64u(new TextEncoder().encode('{"aud":"x"}'))}`)),
    false);
}

/* THE SHIPPED PAIR, where the private key is at hand.
 *
 * The public constant in app.js and the private key in the sender's secrets
 * are edited in different places at different times, and a mismatch is
 * invisible until a push service answers 401 -- by which point every
 * subscription taken on the old key is already dead. This is the check for
 * that, and it can only run where the private key exists: locally, and never
 * in CI, where it is gitignored on purpose.
 *
 * It says out loud when it is skipped. A verification that quietly does
 * nothing is worse than no verification, because it reads as one. */
if (fs.existsSync(".vapid/private.key")) {
  const shipped = { publicKey, subject: "mailto:admin@draftbaron.com",
    privateKey: fs.readFileSync(".vapid/private.key", "utf8").trim() };
  const hdr = await vapidHeader(dev.sub.endpoint, shipped, Date.now());
  const [tok] = hdr.slice("vapid t=".length).split(", k=");
  const [h, p, sg] = tok.split(".");
  const raw = unb64u(publicKey);
  const vk = await subtle.importKey("jwk",
    { kty: "EC", crv: "P-256", x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  check("the shipped private key signs for the published public key",
    await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk,
      unb64u(sg), new TextEncoder().encode(`${h}.${p}`)), true);
} else {
  console.log("skip .vapid/private.key not present — the shipped PAIR is unverified here");
}

// ---- the send, with the network stubbed -----------------------------------
{
  const vapid = testPair;
  let seen = null;
  const fakeFetch = (url, init) => { seen = { url, init }; return { status: 201 }; };

  const res = await sendPush(dev.sub, MSG, vapid, { fetch: fakeFetch });
  check("a 201 is a success", [res.ok, res.gone], [true, false]);
  check("it posts to the endpoint itself", seen.url, dev.sub.endpoint);
  check("the content encoding names the scheme", seen.init.headers["Content-Encoding"], "aes128gcm");
  check("the body is a stream of bytes, not JSON",
    seen.init.headers["Content-Type"], "application/octet-stream");
  check("a TTL is always sent, or some services drop the message",
    seen.init.headers.TTL, "3600");

  /* 404 and 410 mean the endpoint is dead for good — uninstalled, or dropped
     by the browser. The caller is told to DELETE rather than left to retry a
     row that can never succeed again. */
  for (const status of [404, 410]) {
    const r = await sendPush(dev.sub, MSG, vapid, { fetch: () => ({ status }) });
    check(`a ${status} marks the subscription gone`, [r.ok, r.gone], [false, true]);
  }
  const r5 = await sendPush(dev.sub, MSG, vapid, { fetch: () => ({ status: 503 }) });
  check("a 503 is a failure but NOT a reason to delete", [r5.ok, r5.gone], [false, false]);
}

console.log(`\n${oks} ok, ${fails} failed`);
if (fails) process.exit(1);
