/** Tailwind build config.
 *
 * This mirrors the config that used to live inline in index.html for the CDN
 * script. The CDN build compiled styles in the browser on every page load —
 * fine for a prototype, wrong for production: it costs a render-blocking
 * download plus compile on each visit, and if the CDN is slow or blocked the
 * app renders completely unstyled. `npm run build:css` produces styles.css,
 * which is committed and served from the same origin as the app.
 */
module.exports = {
  /* sim.js too: the test bench builds its own markup, and five classes used
     only there (invisible, col-span-2, text-wcred, border-wcred/60,
     min-h-[1.5em]) were being purged -- so the bench rendered with a broken
     grid and an "invisible" that showed. A file that generates markup has to
     be scanned, or Tailwind removes exactly the styles it needs. */
  content: ["./index.html", "./app.js", "./sim.js"],
  theme: {
    extend: {
      colors: {
        wcred: { DEFAULT: "#C8102E", hov: "#E22945" },
        wcgold: "#FFC72C",
        wcgreen: "#00A859",
        wcblue: "#1A7DC4",
        wcnavy: "#070B24",
        // Semantic state — deliberately NOT the brand accent, so "this is
        // urgent" never reads the same as "this is a button".
        live: "#4FB286",
        warn: "#E8B93F",
        danger: "#E5646A",
      },
    },
  },
};
