/** Tailwind build config.
 *
 * This mirrors the config that used to live inline in index.html for the CDN
 * script. The CDN build compiled styles in the browser on every page load —
 * fine for a prototype, wrong for production: it costs a render-blocking
 * download plus compile on each visit, and if the CDN is slow or blocked the
 * app renders completely unstyled. `npm run build:css` produces styles.css,
 * which is committed and served from the same origin as the app.
 */
/* rgb(var(--x) / <alpha-value>): the variable holds "15 23 42", not a colour,
   which is what lets every /10 /20 /95 modifier keep working. */
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

module.exports = {
  /* sim.js too: the test bench builds its own markup, and five classes used
     only there (invisible, col-span-2, text-wcred, border-wcred/60,
     min-h-[1.5em]) were being purged -- so the bench rendered with a broken
     grid and an "invisible" that showed. A file that generates markup has to
     be scanned, or Tailwind removes exactly the styles it needs. */
  content: ["./index.html", "./app.js", "./sim.js"],
  theme: {
    extend: {
      /* Colours resolve through CSS custom properties, so a theme is a block of
         variables rather than a second set of classes.

         This is the whole lever. 1,330 places in this app say bg-slate-900 or
         text-slate-400; redefining what slate-900 MEANS re-skins all of them
         without touching app.js. It is deliberately sneaky and it needs saying
         out loud: after this, `slate-900` is not slate. It is "the card
         surface", and in another theme it is cream.

         The <alpha-value> placeholder is what makes it work at all -- 164 sites
         carry an opacity modifier (bg-slate-900/95, bg-wcred/20), and those
         keep working only because the variable holds space-separated CHANNELS
         (15 23 42) rather than a colour, letting Tailwind supply the alpha.

         The names stay. wcgold and wcred read oddly once a theme makes them
         cream and Panini red, but two tests match on `bg-wcred` and
         `text-wcgold` in className strings, and 182 call sites use them.
         Renaming is a separate mechanical commit, not a rider on this one. */
      colors: {
        slate: {
          100: c("--c-slate-100"), 200: c("--c-slate-200"), 300: c("--c-slate-300"),
          400: c("--c-slate-400"), 500: c("--c-slate-500"), 600: c("--c-slate-600"),
          700: c("--c-slate-700"), 800: c("--c-slate-800"), 900: c("--c-slate-900"),
          950: c("--c-slate-950"),
        },
        /* The stock palettes carry the app's STATE colours -- text-red-400 for
           a loss, text-emerald-400 for a gain, text-amber-300 for a warning --
           across 91 sites that a theme could not reach, because they resolve
           to Tailwind's own hexes and never touched a variable. On a dark
           ground they were fine and invisible as a problem. On cream, amber-300
           text is not there at all. Only the shades actually used are listed;
           extend deep-merges, so the rest of each scale is untouched. */
        amber: { 300: c("--c-amber-300"), 400: c("--c-amber-400"), 500: c("--c-amber-500"),
                 600: c("--c-amber-600"), 700: c("--c-amber-700"), 950: c("--c-amber-950") },
        emerald: { 300: c("--c-emerald-300"), 400: c("--c-emerald-400"), 500: c("--c-emerald-500"),
                   600: c("--c-emerald-600"), 800: c("--c-emerald-800") },
        red: { 300: c("--c-red-300"), 400: c("--c-red-400"), 500: c("--c-red-500") },
        rose: { 400: c("--c-rose-400") },
        sky: { 300: c("--c-sky-300"), 400: c("--c-sky-400") },
        orange: { 300: c("--c-orange-300"), 500: c("--c-orange-500") },
        purple: { 500: c("--c-purple-500") },
        wcred: { DEFAULT: c("--c-wcred"), hov: c("--c-wcred-hov") },
        wcgold: c("--c-wcgold"),
        wcgreen: c("--c-wcgreen"),
        wcblue: c("--c-wcblue"),
        wcnavy: c("--c-wcnavy"),
        // Semantic state — deliberately NOT the brand accent, so "this is
        // urgent" never reads the same as "this is a button".
        live: c("--c-live"),
        warn: c("--c-warn"),
        danger: c("--c-danger"),
      },
      /* Shape and type, same trick. `full` is deliberately absent: 54 sites are
         avatars, crests and pills that must stay circular whatever a theme
         thinks a corner should be. */
      borderRadius: {
        DEFAULT: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)",
        xl: "var(--r-xl)", "2xl": "var(--r-2xl)",
      },
      fontFamily: {
        sans: "var(--font-body)",
        mono: "var(--font-mono)",
        display: "var(--font-display)",
      },
    },
  },
};
