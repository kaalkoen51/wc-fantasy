#!/usr/bin/env node
"use strict";
/* Generate the VAPID key pair that signs push notifications.
 *
 *   node vapid_keys.js            # writes .vapid/private.key, prints the public one
 *   node vapid_keys.js --show     # also prints the private key to the terminal
 *
 * Two long strings, made once and then left alone. The PUBLIC one goes in
 * app.js (VAPID_PUBLIC_KEY) and ships to every browser -- it is not a secret,
 * it is how Apple and Google check that a notification claiming to come from
 * DraftBaron really did. The PRIVATE one goes into the sender and nowhere
 * else:
 *
 *   supabase secrets set VAPID_PRIVATE_KEY="$(cat .vapid/private.key)"
 *
 * The private key is written to a gitignored FILE rather than printed, and
 * that default is the whole point: a secret that reaches a terminal reaches
 * the scrollback, the CI log and anywhere that transcript is later pasted.
 * --show exists for when you genuinely need to read it, and makes that a
 * decision rather than a side effect.
 *
 * THE PAIR MUST MATCH. A browser stores the public key inside the delivery
 * address it hands you when someone says yes to notifications, and the push
 * service checks every send against it. Change the pair later and every
 * subscription taken before the change stops working -- silently, because the
 * push service rejects the send rather than telling the user. So: generate
 * once, before anybody subscribes, and keep the private key somewhere you will
 * still have it in a year.
 *
 * Written by hand rather than pulled from a package: this is one call to
 * Node's own crypto and a base64url encode, and a dependency that can generate
 * your signing key is a dependency worth not having.
 */
const { generateKeyPairSync, createPublicKey } = require("crypto");
const fs = require("fs");
const path = require("path");

// base64url: what the Web Push spec and every push service expect. Plain
// base64 is rejected, and the difference is three characters.
const b64u = (buf) => buf.toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) =>
  Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

/* The public key has to be the raw uncompressed point -- 65 bytes starting
   with 0x04 -- not the DER/SPKI wrapper Node exports by default. The JWK form
   gives the two coordinates directly, which is the least fiddly way to rebuild
   it and the one that cannot silently include a header. */
const pubJwk = createPublicKey(privateKey).export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), fromB64u(pubJwk.x), fromB64u(pubJwk.y)]);
const priv = fromB64u(privJwk.d);

// Cheap, and it catches the one mistake that would not show up until a real
// push service rejected a send weeks later.
if (pub.length !== 65) throw new Error(`public key is ${pub.length} bytes, expected 65`);
if (pub[0] !== 4) throw new Error("public key is not an uncompressed point");
if (priv.length !== 32) throw new Error(`private key is ${priv.length} bytes, expected 32`);

const dir = path.join(__dirname, ".vapid");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "private.key");
fs.writeFileSync(file, b64u(priv) + "\n", { mode: 0o600 });

console.log("Public key — put this in app.js as VAPID_PUBLIC_KEY (safe to commit):");
console.log("\n  " + b64u(pub) + "\n");
console.log(`Private key written to ${path.relative(process.cwd(), file)} (gitignored, 0600).`);
console.log("Store it in the sender and nowhere else:");
console.log('\n  supabase secrets set VAPID_PRIVATE_KEY="$(cat .vapid/private.key)"\n');
if (process.argv.includes("--show")) {
  console.log("Private key (you asked):");
  console.log("\n  " + b64u(priv) + "\n");
}
