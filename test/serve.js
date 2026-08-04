/* A static server for the built site, so the browser harness loads exactly
   what Cloudflare serves -- public/, assembled by build.js -- rather than the
   repo root. Deliberately tiny: any real server here is a dependency that can
   itself break, and this only has to answer GETs. */
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  // Never serve outside public/ -- the harness must not be able to read the
  // repo, or a test could pass against files the real site does not have.
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.PORT) || 4173, () =>
  console.log(`serving public/ on ${server.address().port}`));
