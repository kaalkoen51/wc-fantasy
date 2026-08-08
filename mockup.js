"use strict";
/* Drives the two motion mock-ups in mockup.html. Temporary, like that file.
 *
 * It is a separate file rather than an inline <script> because the CSP is
 * `script-src 'self'` with no 'unsafe-inline' -- the same reason theme.js is a
 * file. Delete both together. */
(function () {
  /* Mgr1's actual drafted squad from the test seed, resolved to the real photo
     and crest ids in photos.json. Real data on purpose: the long names are the
     ones that have broken layouts here before ("Roemeratoe", "Magalhaes"), and
     a mock-up that quietly uses short ones proves nothing. */
  const SQUAD = [
    { band: "GK",  n: "Mastil",     p: 304229, c: 1532 },
    { band: "DEF", n: "Degenek",    p: 2742,   c: 20 },
    { band: "DEF", n: "Debast",     p: 304228, c: 1 },
    { band: "DEF", n: "Magalhaes",  p: 22224,  c: 6 },
    { band: "DEF", n: "Johnston",   p: 78547,  c: 5529 },
    { band: "DEF", n: "Sugawara",   p: 32887,  c: 12 },
    { band: "MID", n: "Mukau",      p: 375598, c: 1508 },
    { band: "MID", n: "Roemeratoe", p: 36842,  c: 5530 },
    { band: "MID", n: "Seri",       p: 3243,   c: 1501 },
    { band: "MID", n: "Ashour",     p: 17269,  c: 32 },
    { band: "FWD", n: "Dembele",    p: 153,    c: 2,  foil: true },
    { band: "FWD", n: "Rahimi",     p: 36579,  c: 31 },
    { band: "GK",  n: "Beiranvand", p: 2682,   c: 22 },
    { band: "DEF", n: "Lee",        p: 2897,   c: 17 },
    { band: "CLUB", n: "Brazil",    p: null,   c: 6 },
  ];
  const BANDS = ["GK", "DEF", "MID", "FWD", "CLUB"];
  const PHOTO = (id) => "https://media.api-sports.io/football/players/" + id + ".png";
  const CREST = (id) => "https://media.api-sports.io/football/teams/" + id + ".png";

  /* Not all at the same angle, or a page of stickers reads as a skewed grid
     rather than as things stuck on by hand. Deterministic, so a replay looks
     the same twice -- random tilts make a design impossible to judge. */
  const TILTS = [-2, 1.6, -0.9, 2.2, -1.7, 1.1, -2.4, 0.8, 1.9, -1.2];

  function stickerHtml(s) {
    const face = s.p
      ? `<img src="${PHOTO(s.p)}" alt="" loading="lazy">`
      : `<img src="${CREST(s.c)}" alt="" loading="lazy"
             style="object-fit:contain;padding:8px;background:#F6EFDF">`;
    const crest = s.p ? `<img class="crest" src="${CREST(s.c)}" alt="" loading="lazy">` : "";
    return `<span class="st ${s.foil ? "foil" : ""}">${face}${crest}
      <span class="plate">${s.n}</span></span>`;
  }

  /* The album page: bands of stickers, one band per position. `--i` is the
     deal order and has to run across the WHOLE page, not restart per band, or
     the second band starts dealing before the first has finished. */
  function pageHtml() {
    let i = 0, out = "";
    for (const band of BANDS) {
      const inBand = SQUAD.filter((s) => s.band === band);
      if (!inBand.length) continue;
      out += `<div class="band"><div class="lab">${band}</div><div class="row">`
        + inBand.map((s) => `<span class="slot" style="--i:${i++};--tilt:${
            TILTS[(i - 1) % TILTS.length]}deg">${stickerHtml(s)}</span>`).join("")
        + `</div></div>`;
    }
    return out;
  }

  // The draft board behind the flash, so the card is judged in context.
  function boardHtml() {
    const rows = SQUAD.slice(6, 11).map((s, k) =>
      `<div class="pickrow"><span class="no">${22 + k}</span>${stickerHtml(s)}
       <span class="nm">${s.n}</span></div>`).join("");
    return rows;
  }

  for (const el of document.querySelectorAll("[data-page]")) el.innerHTML = pageHtml();
  for (const el of document.querySelectorAll("[data-board]")) el.innerHTML = boardHtml();
  for (const el of document.querySelectorAll("[data-flashsticker]"))
    el.outerHTML = stickerHtml(SQUAD[10]);

  /* B fans out of a single point. The deltas are MEASURED rather than guessed:
     a hand-written translate per slot would have to be re-derived every time
     the grid changes, and would be wrong on any viewport but mine. */
  function setFanOrigin(phone) {
    const page = phone.querySelector("[data-page]");
    if (!page) return;
    const box = page.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height * 0.42;
    for (const slot of page.querySelectorAll(".slot")) {
      const r = slot.getBoundingClientRect();
      slot.style.setProperty("--dx", (cx - r.left - r.width / 2).toFixed(1) + "px");
      slot.style.setProperty("--dy", (cy - r.top - r.height / 2).toFixed(1) + "px");
    }
  }

  /* Restarting a CSS animation needs the class off, a reflow, and the class
     back on -- removing and re-adding in the same frame is coalesced and
     nothing replays. */
  function replay(phone) {
    const modes = ["playing", "deal", "fan"];
    for (const m of modes) phone.classList.remove(m);
    void phone.offsetWidth;
    if (phone.id === "ph-a") phone.classList.add("playing", "deal");
    else if (phone.id === "ph-b") { setFanOrigin(phone); phone.classList.add("fan"); }
    else phone.classList.add("playing");
  }

  for (const btn of document.querySelectorAll("[data-replay]"))
    btn.addEventListener("click", () => replay(document.getElementById(btn.dataset.replay)));

  // Tapping the packet itself is the whole point of A; it must work directly.
  for (const btn of document.querySelectorAll("[data-open]"))
    btn.addEventListener("click", () => replay(btn.closest(".phone")));

  // Play each one once on arrival, staggered, so nothing has to be discovered.
  const order = ["ph-a", "ph-b", "ph-c", "ph-d"];
  order.forEach((id, k) => setTimeout(() => {
    const el = document.getElementById(id);
    if (el) replay(el);
  }, 350 + k * 900));
})();
