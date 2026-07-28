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
  content: ["./index.html"],
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
