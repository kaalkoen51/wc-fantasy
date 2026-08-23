/* Web Push: encrypt a payload for one subscription, and sign the request.
 *
 * Two specifications, and neither is optional. A push service accepts a
 * message only if the body is encrypted to the DEVICE's key (RFC 8291, in the
 * aes128gcm scheme of RFC 8188) and the request is signed by the application
 * server's key (VAPID, RFC 8292). Get either wrong and the failure is a bare
 * 400 with no clue in it.
 *
 * WHY THIS IS PLAIN .mjs AND NOT TYPESCRIPT. It is imported by a Deno edge
 * function and by test_logic.js under Node, and those have to be the SAME
 * file. A copy in each would be two implementations of the only
 * security-sensitive code in the app, and the tests would then be testing the
 * copy that never ships. WebCrypto is identical in both runtimes, so nothing
 * here is Deno-specific and nothing is Node-specific.
 *
 * WHY IT IS HAND-WRITTEN. This is the code that holds the signing key. A
 * third-party dependency here would be code I cannot read at review time
 * sitting next to a secret, and -- since this container is firewalled off
 * from Apple's and Google's push services -- one I could not test either. If
 * neither option can be verified from here, the one with no supply chain is
 * the better bet.
 *
 * WHAT THE TESTS CAN AND CANNOT PROVE. They prove the encryption is
 * self-consistent (a decrypt built from the spec's other side recovers the
 * plaintext), that the header block a push service parses has the right byte
 * layout, and that the JWT has the right shape and verifies against the
 * public key. They CANNOT prove a real push service agrees -- nothing
 * offline can. That is what the "Send a test" button in the alerts panel is
 * for, and why it exists before any trigger does.
 */

const enc = new TextEncoder();

/* The three info strings, exactly as the specs write them, as named constants
   rather than inline literals.
 *
 * They are pinned byte-for-byte in test_webpush.mjs. That does not prove they
 * are RIGHT -- I wrote both sides of the round trip, so a shared
 * misunderstanding would survive it -- but it does mean a later edit cannot
 * drift them silently, and it puts the exact strings in front of whoever
 * reviews this against the RFC. A wrong byte here produces a perfectly valid
 * key that the receiving device simply cannot derive, and the only symptom is
 * a notification that never arrives. */
export const INFO = {
  key: "WebPush: info",                    // RFC 8291 s3.4
  cek: "Content-Encoding: aes128gcm\0",    // RFC 8188 s2.2
  nonce: "Content-Encoding: nonce\0",      // RFC 8188 s2.2
};

// RFC 8188 s2: 0x02 ends the LAST record; 0x01 means another follows. This
// sender only ever writes one record, so 0x01 would leave the device waiting
// for a second that never comes.
export const LAST_RECORD = 2;
const crypto = globalThis.crypto;
const subtle = crypto.subtle;

/* base64url, in both directions. Plain base64 is rejected by every push
   service and the difference is three characters. */
export const b64u = (buf) => {
  const b = new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64u = (s) => {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const cat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/* HKDF as two explicit steps rather than one call.
 *
 * WebCrypto's deriveBits("HKDF") does extract-and-expand together, which is
 * the wrong shape here: RFC 8291 extracts with the auth secret and expands
 * with one info string, then RFC 8188 extracts AGAIN with the salt and
 * expands twice more. Written out, each step is checkable against the line of
 * spec it implements; folded into deriveBits it is an argument order nobody
 * can review. */
async function hmac(keyBytes, data) {
  const k = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}
const hkdfExtract = (salt, ikm) => hmac(salt, ikm);
async function hkdfExpand(prk, info, length) {
  // One block is always enough here: every output is 16, 12 or 32 bytes.
  const t = await hmac(prk, cat(info, Uint8Array.of(1)));
  return t.slice(0, length);
}

// A P-256 public key as the raw uncompressed point the specs pass around.
async function rawPublic(key) {
  return new Uint8Array(await subtle.exportKey("raw", key));
}

/* The shared secret, and from it the content key and nonce (RFC 8291 §3.4,
   RFC 8188 §2.2). The two "info" strings are exact and unforgiving: a wrong
   byte produces a perfectly valid key that the device cannot derive. */
async function deriveKeys(uaPublicRaw, authSecret, asPrivate, asPublicRaw, salt) {
  const uaKey = await subtle.importKey("raw", uaPublicRaw,
    { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits(
    { name: "ECDH", public: uaKey }, asPrivate, 256));

  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = cat(enc.encode(INFO.key), Uint8Array.of(0), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(await hkdfExtract(authSecret, shared), keyInfo, 32);

  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, enc.encode(INFO.cek), 16);
  const nonce = await hkdfExpand(prk, enc.encode(INFO.nonce), 12);
  return { cek, nonce };
}

/* The aes128gcm body: a header block the service parses, then one record.
 *
 *   salt (16) | rs (4, big-endian) | idlen (1) | as_public (65) | ciphertext
 *
 * The payload is padded with a single 0x02 -- the delimiter that says "last
 * record" (RFC 8188 §2). Sending 0x01 instead means "another record follows",
 * and the device waits for one that never comes.
 *
 * `salt` and `asKeys` are injectable so a test can pin every byte; both
 * default to fresh randomness, which is what production must always use. */
export async function encryptPayload(plaintext, { p256dh, auth }, opts = {}) {
  const uaPublicRaw = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublicRaw.length !== 65 || uaPublicRaw[0] !== 4)
    throw new Error(`p256dh is not an uncompressed P-256 point (${uaPublicRaw.length} bytes)`);
  if (authSecret.length !== 16)
    throw new Error(`auth secret is ${authSecret.length} bytes, expected 16`);

  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const asKeys = opts.asKeys || await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = await rawPublic(asKeys.publicKey);

  const { cek, nonce } = await deriveKeys(
    uaPublicRaw, authSecret, asKeys.privateKey, asPublicRaw, salt);

  const body = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  const padded = cat(body, Uint8Array.of(LAST_RECORD));
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, key, padded));

  const rs = 4096;
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublicRaw.length;                 // 65
  return cat(header, asPublicRaw, ct);
}

/* The other side of the same spec, for tests only.
 *
 * It is here rather than in the test file on purpose: a decrypt written from
 * the same misunderstanding as the encrypt would round-trip happily and prove
 * nothing, so this is deliberately written from the RECEIVER's description --
 * parse the header the way a device does, derive with the roles swapped -- and
 * shares no code with encryptPayload above the HKDF primitives. It is not
 * exported to the edge function's send path and nothing in production calls it. */
export async function decryptPayload(bodyBytes, uaKeys, authSecretB64) {
  const body = new Uint8Array(bodyBytes);
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublicRaw = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const authSecret = unb64u(authSecretB64);

  const asKey = await subtle.importKey("raw", asPublicRaw,
    { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits(
    { name: "ECDH", public: asKey }, uaKeys.privateKey, 256));
  const uaPublicRaw = await rawPublic(uaKeys.publicKey);

  const keyInfo = cat(enc.encode(INFO.key), Uint8Array.of(0), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(await hkdfExtract(authSecret, shared), keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, enc.encode(INFO.cek), 16);
  const nonce = await hkdfExpand(prk, enc.encode(INFO.nonce), 12);

  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ct));
  // Strip the trailing delimiter and any padding zeros before it.
  /* STRICT about the delimiter, deliberately. A real device accepts 0x01 too
     (another record follows) -- but this sender only ever writes one, so
     accepting 0x01 here would let a 0x01 sabotage round-trip cleanly and
     hide the one bug that makes a device wait forever. */
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== LAST_RECORD)
    throw new Error(`record delimiter is 0x0${padded[end]}, expected 0x02 (last record)`);
  return new TextDecoder().decode(padded.slice(0, end));
}

/* The VAPID Authorization header (RFC 8292).
 *
 * `aud` is the ORIGIN of the endpoint and nothing more -- scheme and host,
 * no path. Sending the whole endpoint URL is the classic mistake and earns a
 * 401 that says nothing about which field was wrong.
 *
 * `exp` is capped at 24h by the spec and rejected if it is in the past, so it
 * is generated per request rather than cached. */
export function audienceOf(endpoint) {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

export async function vapidHeader(endpoint, { publicKey, privateKey, subject }, nowMs) {
  const now = Math.floor((nowMs ?? Date.now()) / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud: audienceOf(endpoint), exp: now + 12 * 3600, sub: subject };
  const signingInput = `${b64u(enc.encode(JSON.stringify(header)))}.${
    b64u(enc.encode(JSON.stringify(claims)))}`;

  /* The private key arrives as the raw 32-byte scalar, which WebCrypto cannot
     import on its own -- it needs the matching public coordinates too. They
     come from the public key we already ship, so the pair is checked by
     construction: a mismatched pair fails to import rather than producing
     signatures nobody can verify. */
  const pub = unb64u(publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: privateKey,
    x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const key = await subtle.importKey("jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // ES256 wants the raw r||s pair, not the DER wrapper some libraries emit.
  const sig = new Uint8Array(await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)));

  return `vapid t=${signingInput}.${b64u(sig)}, k=${publicKey}`;
}

/* One send. Returns { ok, status, gone } -- `gone` meaning the subscription
 * is dead and should be deleted rather than retried.
 *
 * 404 and 410 are the push service saying this endpoint will never work
 * again: the app was uninstalled, or the browser dropped it. Retrying those
 * forever is how a subscriptions table fills with rows that can never
 * succeed, so the caller is told to delete rather than left to guess. */
export async function sendPush(sub, payload, vapid, opts = {}) {
  const body = await encryptPayload(payload, sub, opts);
  const auth = await vapidHeader(sub.endpoint, vapid, opts.nowMs);
  const res = await (opts.fetch || fetch)(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl ?? 3600),
      Urgency: opts.urgency || "normal",
    },
    body,
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status,
           gone: res.status === 404 || res.status === 410 };
}
