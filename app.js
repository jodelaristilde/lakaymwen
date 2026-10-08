// Lakaymwen.co — site logic. Talks to Supabase for sign-in, notices and messages.
(() => {
  const C = window.LAKAYMWEN_CONFIG || {};
  const TOWNS = window.LAKAYMWEN_TOWNS || [];
  const TEXT = window.LAKAYMWEN_TEXT;
  const $ = id => document.getElementById(id);

  // tolerate stray spaces or a trailing slash pasted with the keys
  if (typeof C.SUPABASE_URL === "string") C.SUPABASE_URL = C.SUPABASE_URL.trim().replace(/\/+$/, "");
  if (typeof C.SUPABASE_ANON_KEY === "string") C.SUPABASE_ANON_KEY = C.SUPABASE_ANON_KEY.trim();
  const configured = typeof C.SUPABASE_URL === "string" && C.SUPABASE_URL.startsWith("https://") &&
    typeof C.SUPABASE_ANON_KEY === "string" && !C.SUPABASE_ANON_KEY.includes("PASTE");
  const sb = configured && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  };

  const LANGS = ["en", "ht", "fr"];
  const savedLang = store.get("lkm-lang");
  const browserLang = (navigator.language || "").slice(0, 2).toLowerCase();
  let lang = LANGS.includes(savedLang) ? savedLang : (browserLang === "fr" ? "fr" : "en");
  const locale = () => lang === "ht" ? "fr-HT" : lang === "fr" ? "fr-FR" : "en-US";
  let me = null, profile = null;
  let townCounts = {}, recentData = [], lastResults = null;
  let thread = null, reportNotice = null;
  const L = () => TEXT[lang];
  const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const clean = s => norm(s).replace(/[%_,()*\\]/g, "");
  const pageUrl = () => location.origin + location.pathname;

  // Skip empty pieces (null, false, 0, "") so "x && el(...)" never shows a stray word
  const isKid = k => k != null && k !== false && k !== 0 && k !== "";
  const nativeReplace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) { return nativeReplace.apply(this, kids.flat().filter(isKid)); };
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    kids.flat().forEach(k => isKid(k) && e.append(k));
    return e;
  }
  function say(id, text, isError) {
    const m = $(id);
    m.textContent = text || "";
    m.classList.toggle("error", !!isError);
    m.hidden = !text;
  }
  function needDb(msgId) {
    if (sb) return true;
    say(msgId, L().setup, true);
    return false;
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return ""; }
  }
  function openDlg(id) { const d = $(id); if (!d.open) d.showModal(); }

  /* ---------- Language ---------- */
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-t]").forEach(e => {
      const v = L()[e.dataset.t];
      if (typeof v !== "string") return;
      if (e.hasAttribute("data-html")) e.innerHTML = v; else e.textContent = v;
    });
    document.querySelectorAll("[data-t-aria]").forEach(e => { const v = L()[e.dataset.tAria]; if (typeof v === "string") e.setAttribute("aria-label", v); });
    document.querySelectorAll("[data-ph]").forEach(e => { const v = L()[e.dataset.ph]; if (typeof v === "string") e.placeholder = v; });
    document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    if (!sb) { $("setup-banner").textContent = configured ? L().offline_msg : L().setup; $("setup-banner").hidden = false; }
    if ($("town-filter")) $("town-filter").placeholder = L().town_filter;
    renderTowns();
    renderHaiti();
    renderFeatured(); updateSide(); renderPwoveb();
    fillBdaySelects("r"); fillBdaySelects("pr"); applySpecialDay(); renderBirthdays(); grooveUI();
    if (curHash === "#privacy") renderPrivacy();
    if (curHash === "#admin") renderAdmin();
    if (currentMember) renderMemberPage(currentMember);
    if (lastResults) renderResults();
    if (pageFor(curHash)) route();
    refreshAlerts();
    if (typeof renderPymk === "function" && pymkData) renderPymk();
  }
  document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => {
    lang = b.dataset.lang; store.set("lkm-lang", lang); applyLang(); syncLangMeta();
  }));

  /* ---------- Town lists ---------- */
  function fillTownSelects() {
    ["s-town", "pr-town", "r-town", "ls-town"].forEach(id => TOWNS.forEach(t => $(id).add(new Option(t, t))));
    ["r-country", "pr-country"].forEach(id => COUNTRIES.forEach(c => $(id).add(new Option(c, c))));
  }
  function renderTowns() {
    const groups = {};
    const f = norm($("town-filter") ? $("town-filter").value : "");
    const list = f ? TOWNS.filter(t => norm(t).includes(f)) : TOWNS;
    if (!list.length) { $("az").replaceChildren(); $("town-list").replaceChildren(el("p", { class: "empty", text: L().none_town })); return; }
    list.forEach(t => { const k = norm(t)[0].toUpperCase(); (groups[k] = groups[k] || []).push(t); });
    const letters = Object.keys(groups).sort();
    $("az").replaceChildren(...letters.map(k => el("a", { href: "#letter-" + k, text: k,
      onclick: e => { e.preventDefault(); $("letter-" + k).scrollIntoView({ behavior: "smooth", block: "start" }); } })));
    $("town-list").replaceChildren(...letters.map(k => el("div", { class: "letter" },
      el("h3", { id: "letter-" + k, text: k }),
      el("ul", {}, groups[k].map(t => el("li", {},
        el("button", { type: "button", onclick: () => openAuth(t) }, t))))
    )));
  }
  if ($("town-filter")) $("town-filter").addEventListener("input", renderTowns);

  /* ---------- Haiti Facts + department map ---------- */
  const DEPTS = window.LAKAYMWEN_DEPTS || [], FACTS = window.LAKAYMWEN_FACTS || [];
  function renderHaiti() {
    if (!$("fact-list")) return;
    const open = [...document.querySelectorAll("#fact-list details[open]")].map(d => d.dataset.id);
    $("fact-list").replaceChildren(...FACTS.map(f => {
      const d = el("details", { "data-id": f.id }, el("summary", { text: f[lang].t }), el("p", { text: f[lang].b }));
      if (open.includes(f.id)) d.open = true;
      return d;
    }));
    if ($("map-spots")) $("map-spots").replaceChildren(...DEPTS.map(d => el("button", {
      class: "spot", type: "button", style: `left:${d.x}%;top:${d.y}%`, "aria-label": d.name, text: d.name,
      onclick: () => openDept(d)
    })));
  }
  /* ---------- Photos ---------- */
  const initialsOf = name => (name || "?").split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const memberCache = new Map();
  function avatar(p, cls) {
    let node;
    if (p && p.photo_url) {
      node = el("img", { class: "avatar photo " + (cls || ""), src: p.photo_url, alt: "", loading: "lazy" });
      node.addEventListener("error", () => node.replaceWith(avatar(Object.assign({}, p, { photo_url: null }), cls)), { once: true });
    } else node = el("div", { class: "avatar " + (cls || ""), "aria-hidden": "true", text: initialsOf(p && p.display_name) });
    if (p && p.id && p.display_name) { node.dataset.hc = p.id; memberCache.set(p.id, Object.assign(memberCache.get(p.id) || {}, p)); }
    return node;
  }
  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error("not an image")); return; }
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight), size = Math.min(500, s);
        const c = document.createElement("canvas"); c.width = c.height = size;
        c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error("resize failed")), "image/jpeg", 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }
  async function uploadPhoto(blob) {
    const path = me.id + "/avatar.jpg";
    const { error } = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) throw error;
    const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    return /^(data|blob):/.test(url) ? url : url + "?v=" + Date.now();
  }
  const PROFILE_COLS = "id,username,display_name,name_key,first_name,last_name,nickname,hometown,katye,country,state,lives_in,schools,school_list,family,family_key,photo_url,bio,founding,old_username,created_at";

  /* ---------- Old-site profile questions: shared by Register and Edit profile ---------- */
  const COUNTRIES = window.LAKAYMWEN_COUNTRIES || [];
  const STATES = window.LAKAYMWEN_STATES || {};
  // Show a state / province drop-down only for countries that have a list
  function syncState(p, value) {
    const list = STATES[$(p + "-country").value];
    const sel = $(p + "-state");
    $(p + "-state-wrap").hidden = !list;
    sel.replaceChildren(new Option(L().pick_state, ""));
    if (list) list.forEach(s => sel.add(new Option(s, s)));
    sel.value = list && value && list.includes(value) ? value : "";
  }
  // "What city?": pick the country first. In Haiti the city must be a Haitian town (from the chosen department).
  const HT_DEPTS = window.LAKAYMWEN_DEPTS || [];
  const HT_TOWNS = window.LAKAYMWEN_TOWNS || [];
  const isHaiti = c => /^ha(i|ï)ti$/i.test(String(c || "").trim());
  const haitiTownsFor = dept => { const d = HT_DEPTS.find(x => norm(x.name) === norm(dept || "")); return d ? d.towns : HT_TOWNS; };
  function syncCity(p) {
    const c = $(p + "-country").value, inp = $(p + "-lives");
    let dl = $(p + "-lives-list"); if (!dl) { dl = el("datalist", { id: p + "-lives-list" }); inp.after(dl); inp.setAttribute("list", dl.id); }
    inp.disabled = !c;
    inp.placeholder = !c ? L().city_pick_country : isHaiti(c) ? L().city_pick_ht : "";
    dl.replaceChildren(...(isHaiti(c) ? haitiTownsFor($(p + "-state").value) : []).map(t => el("option", { value: t })));
    if (!c) inp.value = "";
  }
  function livesProblem(p) {
    const c = $(p + "-country").value, v = $(p + "-lives").value.trim();
    if (!v || !isHaiti(c)) return null;
    const list = haitiTownsFor($(p + "-state").value), hit = list.find(t => norm(t) === norm(v));
    if (hit) { $(p + "-lives").value = hit; return null; }
    const dept = $(p + "-state-wrap").hidden ? "" : $(p + "-state").value;
    return [dept ? L().city_not_in_dept(v, dept) : L().city_not_in_ht(v), p + "-lives"];
  }
  ["r", "pr"].forEach(p => {
    $(p + "-country").addEventListener("change", () => { syncState(p); $(p + "-lives").value = ""; syncCity(p); });
    $(p + "-state").addEventListener("change", () => syncCity(p));
    syncCity(p);
  });
  // Schools: one row per school, like family
  // A school is { name, years }; very old profiles stored just the name as text
  const schoolObj = s => typeof s === "string" ? { name: s, years: "" } : { name: s?.name || "", years: s?.years || "" };
  const schoolText = s => { const o = schoolObj(s); return o.name + (o.years ? ` (${o.years})` : ""); };
  const schoolsOf = p => ((p.school_list && p.school_list.length) ? p.school_list : (p.schools ? p.schools.split(" · ") : [])).map(schoolObj).filter(o => o.name);
  // school search helpers: no accents, œ = oe, punctuation ignored; similarity by letter pairs (for "Did you mean…?")
  const schoolKey = t => norm(String(t || "").replace(/œ/g, "oe").replace(/Œ/g, "Oe")).replace(/[^a-z0-9]+/g, " ").trim();
  function schoolSim(a, b) {
    const pairs = t => { const out = new Map(); t = t.replace(/ /g, ""); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
    const A = pairs(a), B = pairs(b); let hit = 0, na = 0, nb = 0;
    A.forEach(v => { na += v; }); B.forEach(v => { nb += v; });
    A.forEach((v, g) => { hit += Math.min(v, B.get(g) || 0); });
    // reward names that contain most of what was typed, even if the name is long
    return na ? Math.max(2 * hit / (na + nb), hit / na * 0.75) : 0;
  }
  function addSchoolRow(p, value, noFocus) {
    const box = $(p + "-schools");
    if (box.children.length >= 15) return;
    const v = schoolObj(value);
    const inp = el("input", { type: "text", class: "school-name", maxlength: "80", autocomplete: "off", role: "combobox", "aria-expanded": "false", placeholder: L().school_ph, "aria-label": L().schools });
    const yrs = el("input", { type: "text", class: "school-years", maxlength: "15", inputmode: "numeric", placeholder: L().school_years_ph, "aria-label": L().school_years });
    inp.value = v.name; yrs.value = v.years;
    const menu = el("ul", { class: "school-menu", role: "listbox", hidden: "" });
    const caret = el("button", { class: "school-caret", type: "button", tabindex: "-1", "aria-label": L().schools, text: "▾" });
    const pick = el("div", { class: "school-pick" }, inp, caret, menu);
    let hideT = null;
    function fill() {
      const f = schoolKey(inp.value);
      const all = [...schoolOpts.values()].sort((x, y) => x.localeCompare(y, "fr"));
      const words = f.split(" ").filter(Boolean);
      // every word typed must appear somewhere in the name, in any order: "petion lycee" finds "Lycée Alexandre-Pétion"
      let list = (words.length ? all.filter(n => { const k = schoolKey(n); return words.every(w => k.includes(w)); }) : all).slice(0, 500);
      const opt = (n, cls) => el("li", { role: "option", class: cls || null,
        onmousedown: e => { e.preventDefault(); inp.value = n; close(); yrs.focus(); } }, n);
      menu.replaceChildren(...list.map(n => opt(n)));
      if (f.length >= 3 && !list.length) {   // nothing found: suggest the closest names (catches typos)
        let near = all.map(n => [n, schoolSim(f, schoolKey(n))]).filter(x => x[1] >= 0.34).sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (near.length) near = near.filter(x => x[1] >= near[0][1] * 0.85);   // only the really close ones
        if (near.length) menu.append(el("li", { class: "school-hint", role: "presentation", text: L().school_didyou }), ...near.map(x => opt(x[0], "school-near")));
      }
      if (f && !list.some(n => schoolKey(n) === f)) menu.append(el("li", { class: "school-new", role: "option",
        onmousedown: e => { e.preventDefault(); close(); yrs.focus(); } }, L().school_add_new(inp.value.trim())));
      menu.hidden = !menu.children.length; inp.setAttribute("aria-expanded", String(!menu.hidden));
    }
    function close() { menu.hidden = true; inp.setAttribute("aria-expanded", "false"); }
    inp.addEventListener("focus", () => { clearTimeout(hideT); fill(); });
    inp.addEventListener("input", fill);
    inp.addEventListener("blur", () => { hideT = setTimeout(close, 150); });
    inp.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    caret.addEventListener("mousedown", e => { e.preventDefault(); if (menu.hidden) { inp.focus(); fill(); } else close(); });
    const row = el("div", { class: "school-row" }, pick, yrs,
      el("button", { class: "fam-x", type: "button", "aria-label": L().remove, text: "×", onclick: () => row.remove() }));
    box.append(row);
    if (!value && !noFocus) inp.focus();
  }
  // always show one empty school box, so people see the list without hunting for "+ Add a school"
  function ensureSchoolRow(p) { const b = $(p + "-schools"); if (b && !b.children.length) addSchoolRow(p, null, true); }
  document.querySelectorAll("[data-add-school]").forEach(b => b.addEventListener("click", () => addSchoolRow(b.dataset.addSchool)));
  // 426 schools in Haiti (lycées, collèges, écoles, universities). Members can still add one that is missing.
  const HT_SCHOOLS = ["American University of the Caribbean", "Bethanie Elementary School", "Centre culturel Le Phare (CCP)", "Centre de formation classique (CFC)", "Centre de formation pour la vie", "Centre d'Enseignement Supérieur et de Recherche Scientifique (SUN)", "Centre de Techniques de Planification et d'Économie Appliquée (CTPEA)", "Centre d'études classique Hadassa (CECH)", "Centre d'Études Diplomatiques et Internationales (CEDI)", "Centre d'Études Secondaires (CES)", "Centre universitaire polytechnique d'Haïti", "Collège adventiste de Diquini", "Collège adventiste de Morija", "Collège adventiste de Pétion-Ville", "Collège Adventiste de Port-de-Paix (CAP)", "Collège adventiste des Gonaïves", "Collège Adventiste du Cap-Haïtien", "Collège adventiste Vertières", "Collège André-Prinston", "Collège Antillais", "Collège Arountino Petit Celin (CAPC)", "Collège Aux-Jours-Heureux (CAJH), Croix-des-Bouquets", "Collège Baptiste-Bethel, Jean-Rabel", "Collège Baptiste du Nord, Limbé", "Collège Bird", "Collège Blaise Pascal, Port-au-Prince", "Collège Bon Berger de Marfranc", "Collège Canado-Haïtien (CCH)", "Collège Canapé-Vert", "Collège Catherine Flon, Carrefour", "Collège Catts Pressoir", "Collège Chrétien d'Haïti", "Collège classique d'Haïti", "Collège Classique Féminin", "Collège classique, Lalue", "Collège Cœur-de-Jésus (Delmas, Port-au-Prince et Santo)", "Collège Cotubanama", "Collège de Côte-Plage", "Collège d'Éducation Moderne (CEM), Carrefour Mariani", "Collège de Mazenod", "Collège de Miragoâne", "Collège d'enseignement classique (CEC)", "Collège d'enseignement moderne, Pétion-Ville", "Collège des professeurs réunis de Jérémie", "Collège diocésain Saint-Paul des Gonaïves", "Collège Dominique-Savio (CODOSA)", "Collège Eben-Ezer (CEE), Fort-Liberté", "Collège Eben-Ezer (CEEG), Gonaïves", "Collège Esaïe Victor", "Collège Etzer-Villaire, Jérémie", "Collège Eugène-de-Mazenod", "Collège Euréka", "Collège évangélique de la Fraternité", "Collège Évangélique Maranatha (CEM), Port-au-Prince", "Collège Excelsior, Delmas", "Collège Franco-Haïtien", "Collège Frantz-Paillère", "Collège Frère-Adrien", "Collège Frère-Adrien-du-Sacré-Cœur", "Collège Frère-André", "Collège Frère-Célestin", "Collège Frère Odile Joseph (FIC), Les Cayes", "Collège Georges-Marc", "Collège Gérard-Gourge", "Collège Hadem", "Collège Hermas-Monnereau", "Collège Immaculée-Conception, Gonaïves", "Collège Immaculée Conception, Les Cayes", "Collège Immaculée-Conception, Port-au-Prince", "Collège Immaculée de Marie, Port-de-Paix", "Collège Interfamilial", "Collège International", "Collège Isaac-Newton", "Collège Isidore-Boirond", "Collège Janvier Émile", "Collège Jean Baptiste Nicolas (CJN), Delmas", "Collège Jean-Claude, Gros-Morne", "Collège Jean-F.-Brierre, Jérémie", "Collège Jean-Narcisse", "Collège Jean-Price-Mars", "Collège Jean-Wilbert-Luma", "Collège José-Marti", "Collège La Patience, Ouanaminthe", "Collège La Providence Cambry Loiseau (CPCL)", "Collège La Source", "Collège Le Caraïbéen, Saint-Marc", "Collège Leclerc-Tertulien", "Collège Le Normalien", "Collège Le Primat-de-l'Esprit, Port-de-Paix", "Collège les Frères Saint-Cyr", "Collège Les Normaliens-Réunis", "Collège L'Essor", "Collège Les Universitaires de Camp-Perrin", "Collège Lucien Hibbert", "Collège Magny Romain, Port-de-Paix", "Collège Marie-Anne (CMA)", "Collège Marie-Dominique-Maz", "Collège Marie-Esther (CME)", "Collège Marie-Reine-Immaculée", "Collège Martin-Luther-King", "Collège méthodiste de Frères (CMF)", "Collège métropolitain d'Haïti (CMH)", "Collège Mixte de Bainet", "Collège Mixte de l'Expérience, Croix-des-Bouquets", "Collège mixte Écho-du-Calvaire (CEC), Fort-Liberté", "Collège mixte Eddy-Pascal", "Collège mixte Gaétan-Amédée", "Collège Mixte Jean Jacques Accaau, Grand-Goâve", "Collège Mixte la Bergerie", "Collège mixte le Progrès, Tabarre", "Collège mixte, Pétion-Ville", "Collège mixte Philadelphie - Dantès Bellegarde", "Collège Mixte Yahvé Nissi, Les Cayes", "Collège Notre-Dame-de-Fatima", "Collège Notre-Dame-de-Lourdes, Port-de-Paix", "Collège Notre-Dame des Petits, Carrefour", "Collège Notre-Dame du Perpétuel Secours, Cap-Haïtien", "Collège Omega, Bois Verna", "Collège Père Farnèse Louis Charles, Grand-Goâve", "Collège Philadelphie, Turgeau", "Collège Pierre Nicolas Wilfrid (CPNW), Delmas", "Collège Regina Assumpta, Cap-Haïtien", "Collège René-Descartes", "Collège Riguelson", "Collège Roger Anglade", "Collège Roi-Henri-IV, Gonaïves", "Collège Ruben-Marc", "Collège Saint-Antoine-de-Padoue, Petite-Rivière-de-Nippes", "Collège Saint-Dominique, Les Cayes", "Collège Sainte-Rose de Lima", "Collège Sainte-Thérèse de Marfranc", "Collège Sainte-Thérèse, Pétion-Ville", "Collège Saint-François-d'Assise", "Collège Saint François Xavier, Grand-Goâve", "Collège Saint-Jean-Baptiste (CSJBM), Miragoâne", "Collège Saint-Joseph, Fort-Liberté", "Collège Saint-Louis de Bourdon", "Collège Saint-Louis, Jérémie", "Collège Saint-Louis Marie de Montfort", "Collège Saint-Martin-de-Porrès, Hinche", "Collège Saint Martin de Tours, Delmas", "Collège Saint-Pierre", "Collège Saint-Thomas-d'Aquin", "Collège Sœur Franciscaine", "Collège Stephen-Alexis, Les Cayes", "Collège Suisse, Jacmel", "Collège Univers-Frère-Raphaël", "Collège Universitaire de Christianville (CUC)", "Collège universitaire d'Haïti (CUH)", "Collège Univers, Ouanaminthe", "Collège Vision Caraïbéenne (CVC), Delmas", "Collège Vision de l'Excellence (COVEX), Port-au-Prince", "Collège Yves-Albert-Boucher", "Cours privé Edmé", "Cours privé mixte Saint-Léonard", "CREFIMA Université", "École Adventiste d'Aquin", "École Adventiste de Diquini, Carrefour", "École Baptiste-Guilgal", "École Boisrond-Tonnerre (La Réserve), Jean-Rabel", "École Cayes-Epin", "École communautaire de Geffray (ECG)", "École communautaire de Santo (ECS), Croix-des-Bouquets", "École Communautaire Nouvelle Génération de Mogé, Thomonde", "École Communautaire Saint-Jean-Baptiste (Cayes-Epin), Thomonde", "École Cyr Guillo, Gonaïves", "École de Delagon", "École des Frères Cyr Guilloux", "École des Frères de Jacmel", "École des Frères de Jérémie", "École des Frères de Port-de-Paix", "École des Frères de Saint-Marc", "École Dumarsais Estimé, Grand-Goâve", "École Fondamentale Adventiste de Desdunes", "École Fondamentale de l'Artibonite, Gonaïves", "École Fondamentale de l'Excellence, Delmas", "École Frère-Hervé, Saint-Marc", "École Frère Lamérique, Port-au-Prince", "École Frère Polycarpe, Port-au-Prince", "École Haïtiano-Arabe", "École Jean-Marie Guilloux, Port-au-Prince", "École La Coccinelle, Belladère", "École La Petite-Sirène", "École Le Monde des Enfants, Bon Repos", "École Léonce-Mégie (FIC), La Vallée-de-Jacmel", "École maternelle Maison-Plein-Soleil", "École Mixte Foyer des Petits", "École Mixte Les Frères Nau", "École Mixte Nazareth", "École Mixte Robert Raikes, Sarthe", "École mixte Terre promise", "École mixte Vision Mondiale", "École Morne Mouton", "École Nationale Alcibiade Pommayrac, Jacmel", "École Nationale d'Anse-à-Veau", "École Nationale d'Anse-d'Ainault", "École Nationale d'Aquin", "École Nationale de Baille-Tourible", "École Nationale de Bainet", "École Nationale de Croix-des-Bouquets", "École Nationale de Faustin, Petit-Goâve", "École Nationale de Fort-Liberté", "École Nationale de Gros-Morne", "École Nationale de Hinche", "École Nationale de Léogâne", "École Nationale de Limbé", "École Nationale de l'Onyx, Cap-Haïtien", "École Nationale de Marceline, Camp-Perrin", "École Nationale de Miragoâne", "École Nationale de Mirebalais", "École Nationale de Ouanaminthe", "École Nationale de Plaisance", "École Nationale de Portail Montrouis, Saint-Marc", "École Nationale de Saint-Louis du Nord", "École Nationale des Arts (ENARTS)", "École Nationale Jean-Baptiste Dutty, Grande-Rivière-du-Nord", "École Nationale Supérieure de Technologie (ENST)", "École Normale Supérieure", "École Notre-Dame de Fatima", "École Notre-Dame-de-Lorette, Belle-Anse", "École pilote internationale", "École Plein Soleil", "École Sainte-Rose-de-Lima, Léogâne", "École Sainte-Thérèse de Lavial", "École Sainte-Trinité de Musique", "École Saint-Jean, Les Cayes", "École Saint-Joseph, Cap-Haïtien", "École Saint-Joseph, Pétion-Ville", "École Saint-Paul - Les Filles de Marie, Jacmel", "École Saint-Pierre de Mirebalais", "École Saint-Vincent", "École Secondaire SOS, Cap-Haïtien", "École Supérieure Catholique de Droit de Jérémie (ESCDROJ)", "École Supérieure d'Infotronique d'Haïti (ESIH)", "École Surin-Éveillard", "Faculté de Droit et des Sciences Économiques", "Faculté de Médecine et de Pharmacie", "Faculté des Sciences (FDS)", "Faculté des Sciences Infirmières de l'Université Épiscopale d'Haïti à Léogâne (FSIL)", "Faculté d'Ethnologie", "Flame University", "Grand Collège Galaxie de Bon Repos", "Grand Collège Indigènes, Port-au-Prince", "Grand Collège L'Humanisme", "Harmony International School", "Hartford University (HU)", "Hispagnola Academy of Sciences of Haiti (HASH)", "INAGHEI", "INFOGEL, École de Logistique", "Institut adventiste franco-haïtien", "Institut de Formation des Cadres (IFC)", "Institut des Hautes Études Commerciales et Économiques (IHECE)", "Institut des Sciences, des Technologies et des Études Avancées d'Haïti (ISTEAH)", "Institut Drop Of Love (IDOL), Limbé", "Institution Chrétienne de Léogâne", "Institution classique du Bonheur, Arcahaie", "Institution Cœur de Marie (ICM), Delmas", "Institution de formation académique moderne, Arcahaie", "Institution de Formation Chrétienne Le Cellier (IFCC)", "Institution de l'ABC Joyeux, Gonaïves", "Institution du Sacré-Cœur", "Institution éducative Notre Dame (INEND)", "Institution Franciscaine d'Haïti", "Institution Françoise et René de la Serre (IFRS)", "Institution la Jachère (ILJ)", "Institution La Sommité, Bon-Repos", "Institution La Source", "Institution Mère-Délia", "Institution mixte AJED Éducation, Port-au-Prince", "Institution Mixte Arc-en-ciel des Gonaïves (IMAG), Gonaïves", "Institution mixte Ave Maria", "Institution Mixte Berceau du Savoir, Hinche", "Institution mixte Canaan de Dampu (IMCDL), Léogâne", "Institution Mixte Flore, Delmas", "Institution mixte Foyer-Divin", "Institution Mixte Genesis", "Institution Mixte Hibiscus (IMH), Pétion-Ville", "Institution mixte La Joconde, Tabarre", "Institution mixte la Perle de l'île", "Institution mixte La Précieuse Montessori", "Institution Mixte le Légionnaire", "Institution mixte Les Combattants (IMC)", "Institution mixte Les Marguerites, Carrefour", "Institution mixte les Rachetées de la Grâce, Port-au-Prince", "Institution Mixte Maison du Sourire (IMS)", "Institution Mixte Marie Cléore", "Institution mixte Saint-Joseph de Pétion-Ville", "Institution Mixte Siècle des Lumières (IMSIL)", "Institution Mixte Siloé de Tiburon", "Institution Mixte Universelle, Ouanaminthe", "Institution Mixte Williamson Adrien", "Institution Moderne de Santo (IMS)", "Institution Nossirhel Lhérisson, Jacmel", "Institution Notre-Dame de Lourdes", "Institution Sainte Marguerite d'Youville", "Institution Saint-François-Xavier", "Institution Saint-Joseph, Cap-Haïtien", "Institution Saint-Louis de Gonzague", "Institution Shekinah 2", "Institution Univers, Ouanaminthe", "Institut La Sève (ILS)", "Institut Polytechnique de Léogâne", "Institut supérieur de technologie et d'électronique d'Haïti", "Institut Universitaire de Formation des Cadres (INUFOCAD)", "Institut Universitaire de l'Ouest (IUO)", "Institut Universitaire des Sciences de l'Éducation (IUSE/CREFI)", "Institut Universitaire et Technologique d'Haïti (INUTECH)", "Institut Universitaire Quisqueya-Amérique (INUQUA)", "Jardins Fleuris", "Jean Alexis Keuslin Christian Academy", "Juvénat du Sacré-Cœur", "Kindergarten Colibri", "Kindergarten Collège de Marie-Andrée (KCMA)", "Kindergarten Les Petits Francophones", "Kindergarten Malouloune, Port-au-Prince", "Lekòl Kominotè Matènwa pou Devlòpman", "Louverture Cleary School", "Lycée Alexandre-Pétion, Port-au-Prince", "Lycée Anacaona, Léogâne", "Lycée Anténor Firmin", "Lycée Augustin-Clerveau, Marmelade", "Lycée Boukman", "Lycée Célie-Lamour, Jacmel", "Lycée Charlemagne-Péralte, Hinche", "Lycée Charles-Belair, Arcahaie", "Lycée de Fort-Liberté", "Lycée de Maïssade", "Lycée de Mirebalais", "Lycée de Petit-Goâve", "Lycée du Bicentenaire, Gonaïves", "Lycée du Cent-Cinquantenaire", "Lycée Fabre-Geffrard, Gonaïves", "Lycée Faustin Soulouque, Petit-Goâve", "Lycée Français Alexandre-Dumas, Port-au-Prince", "Lycée François Capois (LFC), Port-de-Paix", "Lycée Henri-Christophe", "Lycée Horatius-Laventure, Delmas", "Lycée Jacques Ier, Croix-des-Bouquets", "Lycée Jacques-Prévert, Miragoâne", "Lycée Jacques Roumain, Martissant", "Lycée Jean Baptiste Cinéas, Limbé", "Lycée Jean-Jacques-Dessalines", "Lycée Jean-Marie Vincent de Caradeux", "Lycée Jeune Fille, Miragoâne", "Lycée Louis-Joseph-Janvier (LLJJ), Carrefour", "Lycée Marie-Jeanne", "Lycée national de la Saline", "Lycée national de Montrouis", "Lycée National de Pétion-Ville", "Lycée National de Thiotte", "Lycée national du Bicentenaire, Saint-Marc", "Lycée Nord Alexis, Jérémie", "Lycée Philippe-Guerrier, Les Cayes", "Lycée Philippe Jules, La Vallée-de-Jacmel", "Lycée Pierre Eustache-Daniel-Fignolé", "Lycée Pierre-Sully-d'Aquin, Les Cayes", "Lycée Pinchinat, Jacmel", "Lycée Sainte-Anne", "Lycée Sténio Vincent (LSV), Port-de-Paix", "Lycée Sténio Vincent, Saint-Marc", "Lycée Surema Guerrier (LSG), Port-de-Paix", "Lycée Tertulien Guilbaud (LTG), Port-de-Paix", "Lycée Toussaint Louverture", "Marie-Thérèse M. Julien (CMTMJ), Port-au-Prince", "Marimi Garderie Kindergarten", "Millennium International University of the Americas", "Missionnaire Philadelphie de Saint-Louis du Sud", "NASBY Kindergarten", "NCAS (New Caribbean American School), Pétion-Ville", "Nouveau Collège Bird", "Nouveau Collège du Nord, Cap-Haïtien", "Onaville School", "Petit Séminaire Collège Saint-Martial, Port-au-Prince", "Quisqueya Christian School", "Séminaire de Théologie Évangélique de la Grâce (STEG)", "Séminaire de Théologie Évangélique de Port-au-Prince (STEP)", "Theophany University", "Une École Nouvelle", "Union School", "Université Adventiste d'Haïti (UNAH)", "Université Agricole de Management des Métiers de la Production (UAMMP)", "Université Américaine des Sciences Modernes d'Haïti (UNASMOH)", "Université Atlantique d'Haïti (UniversAH)", "Université Autonome Charlemagne Péralte (UNACP)", "Université Autonome de Port-au-Prince (UNAP)", "Université Caraïbe", "Université Chrétienne de la Communauté de Caïman (UCCC), Nord", "Université Chrétienne du Nord d'Haïti", "Université de David Pierre de Pendus (UDPD)", "Université de Fondwa", "Université de l'Académie Haïtienne (UAH)", "Université de la Fondation Dr Aristide", "Université de la Nouvelle Grand'Anse (UNOGA)", "Université de la Paix", "Université de la Renaissance d'Haïti (URH)", "Université de Port-au-Prince", "Université d'État d'Haïti (UEH)", "Université de Technologie d'Haïti (UNITECH)", "Université d'Études Internationales (UDEI)", "Université de Vital Jeff de la Caraïbe", "Université Épiscopale d'Haïti (UNEPH)", "Université Franco-Haïtienne (UFCH), Cap-Haïtien", "Université GOC", "Université Innovatrice d'Haïti (UNIH)", "Université INUKA", "Université Joseph Lafortune (UJLF)", "Université la Pléiade d'Haïti (UPLEH)", "Université Lumière", "Université Métropole d'Haïti (UMH)", "Université Notre-Dame d'Haïti", "Université Paodes", "Université Polyvalente d'Haïti (UPH)", "Université Publique de la Grande-Anse (UPGA)", "Université Publique de l'Artibonite (UPAG), Gonaïves", "Université Publique du Nord-Ouest à Port-de-Paix (UPNOPP)", "Université Queensland (UQ)", "Université Quisqueya", "Université Roi Henri Christophe", "Université Royale d'Haïti", "Université Ruben Leconte (URL)", "Université Russell-Kant (UR-K)", "Université Saint François d'Assise d'Haïti (USFAH)", "Université Saint Gérard (USG)", "Université Saint Jean", "Université Saint-Michel Archange d'Haïti (UNISMAH)", "Université Yahvé Nissi (UNYN)"];
  // School dropdown: well-known schools + every school members have added (new ones show up automatically)
  const schoolOpts = new Map();
  function addSchoolOpts(names) {
    let added = false;
    (names || []).forEach(n => { n = String(n || "").trim(); const k = schoolKey(n).replace(/ /g, "");
      if (n.length >= 2 && k && !schoolOpts.has(k)) { schoolOpts.set(k, n); added = true; } });
    if (!added || !$("school-options")) return;
    $("school-options").replaceChildren(...[...schoolOpts.values()].sort((x, y) => x.localeCompare(y, "fr")).map(n => el("option", { value: n })));
  }
  addSchoolOpts(HT_SCHOOLS);
  ensureSchoolRow("r");
  async function loadSchoolOpts() {
    if (!sb) return;
    let { data, error } = await sb.rpc("school_names");
    if (error && me) ({ data } = await sb.rpc("school_counts"));
    addSchoolOpts((data || []).map(r => r.school));
  }
  const readSchools = p => [...$(p + "-schools").querySelectorAll(".school-row")].map(r => ({
    name: r.querySelector(".school-name").value.trim(), years: r.querySelector(".school-years").value.trim() }))
    .filter(o => o.name.length >= 2).slice(0, 15);
  const RELATIONS = ["mother","father","brother","sister","son","daughter","spouse","grandparent","grandchild","aunt","uncle","niece","nephew","cousin","other"];
  const relName = r => L()["rel_" + r] || r;
  function addFamilyRow(p, rel, name) {
    const box = $(p + "-family");
    if (box.children.length >= 30) return;
    const sel = el("select", { "aria-label": L().relation });
    RELATIONS.forEach(r => sel.add(new Option(relName(r), r)));
    sel.value = rel || "mother";
    const inp = el("input", { type: "text", maxlength: "60", placeholder: L().family_name_ph, "aria-label": L().family_name_ph });
    inp.value = name || "";
    const row = el("div", { class: "family-row" }, sel, inp,
      el("button", { class: "fam-x", type: "button", "aria-label": L().remove, text: "×", onclick: () => row.remove() }));
    box.append(row);
    if (!name) inp.focus();
  }
  document.querySelectorAll("[data-add-family]").forEach(b => b.addEventListener("click", () => addFamilyRow(b.dataset.addFamily)));
  function readFamily(p) {
    return [...$(p + "-family").querySelectorAll(".family-row")].map(r => ({
      relation: r.querySelector("select").value, name: r.querySelector("input").value.trim()
    })).filter(f => f.name.length >= 2).slice(0, 30);
  }
  function readAbout(p) {
    const first = $(p + "-first").value.trim(), last = $(p + "-last").value.trim();
    return {
      first_name: first, last_name: last, display_name: (first + " " + last).trim(),
      nickname: $(p + "-nick").value.trim() || null, hometown: $(p + "-town").value,
      katye: $(p + "-katye").value.trim() || null,
      country: $(p + "-country").value || null,
      state: $(p + "-state-wrap").hidden ? null : ($(p + "-state").value || null),
      lives_in: $(p + "-lives").value.trim() || null,
      school_list: (addSchoolOpts(readSchools(p).map(o => o.name)), readSchools(p)), schools: readSchools(p).map(schoolText).join(" · ").slice(0, 300) || null,
      bio: $(p + "-bio").value.trim() || null, family: readFamily(p)
    };
  }
  function fillAbout(p, pr) {
    let first = pr?.first_name || "", last = pr?.last_name || "";
    if (pr && !first && !last && pr.display_name) { const parts = pr.display_name.split(" "); first = parts.shift(); last = parts.join(" "); }
    $(p + "-first").value = first; $(p + "-last").value = last;
    $(p + "-nick").value = pr?.nickname || "";
    $(p + "-town").value = pr?.hometown || store.get("lkm-town") || "";
    $(p + "-katye").value = pr?.katye || "";
    $(p + "-country").value = pr?.country || "";
    syncState(p, pr?.state);
    syncCity(p);
    $(p + "-lives").value = pr?.country ? (pr?.lives_in || "") : "";
    $(p + "-schools").replaceChildren();
    (pr ? schoolsOf(pr) : []).forEach(s => addSchoolRow(p, s));
    ensureSchoolRow(p);
    $(p + "-bio").value = pr?.bio || "";
    $(p + "-family").replaceChildren();
    (pr?.family || []).forEach(f => addFamilyRow(p, f.relation, f.name));
  }
  function aboutProblem(p) {
    if ($(p + "-first").value.trim().length < 1) return [L().first_req, p + "-first"];
    if ($(p + "-last").value.trim().length < 1) return [L().last_req, p + "-last"];
    if (!$(p + "-town").value) return [L().town_req, p === "r" ? "r-first" : p + "-town"];
    return null;
  }

  /* ---------- Portal: quick buttons, sidebar login, featured members, recent list ---------- */
  /* ---------- Phone: the side menu opens from the ☰ button ---------- */
  function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    $("menu-btn").setAttribute("aria-expanded", String(open));
    $("menu-shade").hidden = !open;
  }
  $("menu-btn").addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
  $("menu-shade").addEventListener("click", () => setMenu(false));
  $("side-menu").addEventListener("click", ev => { if (ev.target.closest("a,button")) setMenu(false); });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && document.body.classList.contains("menu-open")) { setMenu(false); $("menu-btn").focus(); } });
  window.addEventListener("hashchange", () => setMenu(false));

  /* ---------- Pwovèb of the day (changes every day, same for everyone) ---------- */
  const PWOVEB = [["Piti piti zwazo fè nich li.", "Little by little, the bird builds its nest.", "Petit à petit, l'oiseau fait son nid."], ["Men anpil, chay pa lou.", "Many hands make the load light.", "Avec beaucoup de mains, le fardeau n'est pas lourd."], ["Dèyè mòn gen mòn.", "Beyond the mountains, there are more mountains.", "Derrière les montagnes, il y a encore des montagnes."], ["Tout moun se moun.", "Every person is a person.", "Tout le monde est quelqu'un."], ["Lespwa fè viv.", "Hope keeps us alive.", "L'espoir fait vivre."], ["Sak vid pa kanpe.", "An empty sack can't stand up.", "Un sac vide ne tient pas debout."], ["Chak jou pa Dimanch.", "Not every day is Sunday.", "Tous les jours ne sont pas dimanche."], ["Kreyon Bondye pa gen gòm.", "God's pencil has no eraser.", "Le crayon de Dieu n'a pas de gomme."], ["Bèl dan pa di zanmi.", "A nice smile doesn't make a friend.", "De belles dents ne font pas un ami."], ["Sèl pa vante tèt li di li sale.", "Salt doesn't brag that it's salty.", "Le sel ne se vante pas d'être salé."], ["Wòch nan dlo pa konnen doulè wòch nan solèy.", "The rock in the water doesn't know the pain of the rock in the sun.", "La pierre dans l'eau ne connaît pas la douleur de la pierre au soleil."], ["Bay kou bliye, pote mak sonje.", "The one who strikes forgets; the one who bears the scar remembers.", "Celui qui frappe oublie, celui qui porte la cicatrice se souvient."], ["Kabrit gade je mèt kay anvan li antre.", "The goat looks in the owner's eyes before it comes in.", "La chèvre regarde les yeux du maître avant d'entrer."], ["Tanbou lwen gen bon son.", "A faraway drum sounds sweet.", "Le tambour lointain a un beau son."], ["Pitit tig se tig.", "The tiger's cub is a tiger.", "Le petit du tigre est un tigre."], ["Sa ou fè, se li ou wè.", "What you do is what you get back.", "Ce que tu fais, c'est ce que tu reçois."], ["Je wè, bouch pe.", "The eyes see, the mouth stays quiet.", "Les yeux voient, la bouche se tait."], ["Mache sou pinga w, pou w pa pile si m te konnen.", "Walk with care, so you don't step on “if only I had known.”", "Marche avec prudence, pour ne pas marcher sur « si j'avais su »."], ["Kay koule twonpe solèy, men li pa twonpe lapli.", "A leaky roof can fool the sun, but not the rain.", "Une maison qui coule trompe le soleil, mais pas la pluie."], ["Ti chen gen fòs devan kay mèt li.", "A little dog is brave in front of its owner's house.", "Le petit chien est fort devant la maison de son maître."], ["Byen konte, mal kalkile.", "Counted right, figured wrong.", "Bien compté, mal calculé."], ["Ravèt pa janm gen rezon devan poul.", "The cockroach is never right in front of the chicken.", "Le cafard n'a jamais raison devant la poule."], ["Sa ki pa touye ou, angrese ou.", "What doesn't kill you makes you stronger.", "Ce qui ne te tue pas t'engraisse."], ["Pale franse pa di lespri.", "Speaking French doesn't make you wise.", "Parler français ne veut pas dire avoir de l'esprit."]];
  function renderPwoveb() {
    const d = new Date(), day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
    const [ht, en, fr] = PWOVEB[(day + d.getFullYear()) % PWOVEB.length];
    $("pw-ht").textContent = "“" + ht + "”";
    const tr = lang === "fr" ? fr : lang === "ht" ? "" : en;
    $("pw-tr").textContent = tr; $("pw-tr").hidden = !tr;
  }
  let featuredData = null;
  document.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.action;
    if (a === "profile") { me ? go("#member-" + me.id) : openAuth(); }
    else if (a === "tree") { me ? go("#tree/" + me.id) : openAuth(null, "login"); }
    else if (a === "inbox") { me ? openInbox() : openAuth(); }
    else if (a === "search") { go("#search"); setTimeout(() => $("s-name").focus(), 60); }
    else if (a === "login") { openAuth(null, "login"); }
    else if (a === "signout") { $("btn-signout").click(); }
    else if (a === "tell") {
      shareSheet(L().tell_text, siteLink());
    }
  }));
  let blockedIds = new Set(), isAdmin = false;
  const notBlocked = p => !blockedIds.has(p.id);
  const foundingStar = p => p.founding ? el("span", { class: "founding-dot", title: L().founding_badge, text: "★" }) : null;
  function renderFeatured() {
    const box = $("featured");
    if (!sb || !me) { box.replaceChildren(el("p", { class: "empty", text: L().featured_signin })); return; }
    if (!featuredData) return;
    if (!featuredData.length) { box.replaceChildren(el("p", { class: "empty", text: L().featured_none })); return; }
    box.replaceChildren(...featuredData.filter(notBlocked).map(p => el("a", { class: "member-card", href: "#member-" + p.id },
      avatar(p), el("b", {}, p.display_name, foundingStar(p)), el("span", { class: "city", text: [p.hometown, p.katye].filter(Boolean).join(" · ") }))));
  }
  async function loadFeatured() {
    if (sb && me) {
      const { data } = await sb.from("profiles").select(PROFILE_COLS).eq("suspended", false).order("created_at", { ascending: false }).limit(12);
      featuredData = data || [];
    } else featuredData = null;
    renderFeatured();
  }

  function updateSide() {
    $("side-out").hidden = !!me;
    $("side-in").hidden = !me;
    $("side-welcome").textContent = me ? L().welcome(profile?.display_name || "") : "";
    // "Logged in as First Last" at the top of every page
    const nm = profile ? ([profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.display_name || "") : "";
    $("who-bar").hidden = !(me && nm);
    $("who-label").textContent = L().logged_in_as;
    $("who-name").textContent = nm;
    if (me) $("who-name").setAttribute("href", "#member-" + me.id);
    requestAnimationFrame(placeWho);
  }

  function openDept(d) {
    $("dept-title").textContent = d.name;
    $("dept-cap").textContent = L().dept_cap(d.capital);
    $("dept-towns").replaceChildren(...d.towns.map(t => el("li", {},
      el("button", { type: "button", onclick: () => { $("dlg-dept").close(); me ? openTown(t) : openAuth(t); } }, t))));
    openDlg("dlg-dept");
  }
  /* ---------- The Haiti map: departments light up under the mouse ---------- */
  (function mapSetup() {
    const svg = $("map-svg"), box = $("map-box"), tip = $("map-tip");
    if (!svg) return;
    const byId = Object.fromEntries(DEPTS.map(d => [d.id, d]));
    const groups = [...svg.querySelectorAll(".dept")];
    const label = id => svg.querySelector(`.map-labels text[data-dept="${id}"]`);
    let current = null;
    function show(g, ev) {
      const d = byId[g.dataset.dept]; if (!d) return;
      if (current !== g) {
        if (current) { current.classList.remove("on"); const l0 = label(current.dataset.dept); if (l0) l0.classList.remove("on"); }
        current = g; g.classList.add("on");
        if (ev) g.parentNode.appendChild(g);   // mouse: bring to the front so its outline shows (not on keyboard focus, it would drop focus)
        const l = label(d.id); if (l) l.classList.add("on");
        svg.classList.add("hovering");
        $("map-tip-name").textContent = d.name;
        $("map-tip-info").textContent = L().map_tip_towns(d.towns.length);
        $("map-tip-hint").textContent = L().map_tip_hint;
        tip.hidden = false;
      }
      const r = box.getBoundingClientRect();
      let x, y;
      if (ev && ev.clientX != null) { x = ev.clientX - r.left; y = ev.clientY - r.top; }
      else { const b = g.getBoundingClientRect(); x = b.left + b.width / 2 - r.left; y = b.top + b.height / 2 - r.top; }
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(r.width - w - 8, x + 14)) + "px";
      tip.style.top = Math.max(8, Math.min(r.height - h - 8, y - h - 12 < 8 ? y + 18 : y - h - 12)) + "px";
    }
    function hide() {
      if (current) { current.classList.remove("on"); const l = label(current.dataset.dept); if (l) l.classList.remove("on"); }
      current = null; svg.classList.remove("hovering"); tip.hidden = true;
    }
    groups.forEach(g => {
      g.addEventListener("pointermove", ev => { if (ev.pointerType !== "touch") show(g, ev); });
      g.addEventListener("focus", () => show(g));
      g.addEventListener("blur", hide);
      g.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); hide(); go("#register"); });
      g.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); hide(); go("#register"); } });
    });
    svg.addEventListener("pointerleave", hide);
    // clicking anywhere on the map opens the register page, like the old site
    svg.addEventListener("click", () => go("#register"));
  })();
  async function loadTownCounts() {
    townCounts = {};
    if (sb) {
      const { data } = await sb.rpc("town_counts");
      (data || []).forEach(r => { townCounts[r.hometown] = Number(r.members) || 0; });
    }
    renderTowns();
  }


  /* ---------- Notice cards ---------- */
  function noticeCard(n) {
    const link = siteLink() + "/#notice-" + n.id;
    const shareText = L().share_text(n.person_name, n.hometown) + " " + link;
    const mine = me && n.author === me.id;
    const copyBtn = el("button", { class: "btn small ghost", type: "button", text: L().copy_link });
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); copyBtn.textContent = L().copied; }
      catch (e) { window.prompt("", link); }
    });
    const initials = n.person_name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
    return el("article", { class: "card" },
      el("div", { class: "top" },
        el("div", { class: "avatar", "aria-hidden": "true", text: initials }),
        el("div", {},
          el("div", { class: "who", text: n.person_name }),
          el("div", { class: "meta", text: `${L().from} ${n.hometown}` + (n.last_heard ? ` · ${L().lastheard} ${n.last_heard}` : "") }))),
      n.message ? el("p", { text: n.message }) : null,
      el("div", { class: "meta", text: `${L().by}: ${n.posted_by} · ${fmtDate(n.created_at)}` }),
      el("div", { class: "actions" },
        mine ? null : el("button", { class: "btn small", type: "button", text: L().know, onclick: () => knowPerson(n) }),
        el("button", { class: "btn small share-btn", type: "button", onclick: () => shareSheet(L().share_text(n.person_name, n.hometown), link) }, el("span", { class: "share-ic", "aria-hidden": "true" }), el("span", { text: L().share })),
        copyBtn,
        mine ? null : el("button", { class: "linkbtn", type: "button", text: L().report, onclick: () => openReport(n) })
      )
    );
  }
  function renderNoticeList(box, list) {
    if (!list || !list.length) { box.replaceChildren(el("p", { class: "empty", text: L().none_notices })); return; }
    box.replaceChildren(...list.map(noticeCard));
  }
  // A member at a glance: enough to say "that's the person I grew up with"
  // Search results look like Facebook's list: picture, First Last, then City · Katye
  const MSG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.9 2 11.7c0 2.6 1.3 4.9 3.4 6.5L5 22l3.9-2.1c1 .3 2 .4 3.1.4 5.5 0 10-3.9 10-8.7S17.5 3 12 3Z"/></svg>';
  function memberRow(p, key) {
    const self = me && p.id === me.id;
    key = typeof key === "string" ? key : "";
    const hit = txt => key && norm(txt).includes(key);
    const mark = txt => hit(txt) ? el("mark", { text: txt }) : document.createTextNode(txt);
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.display_name || "";
    const place = [p.hometown, p.katye].filter(Boolean).join(" · ");
    // when the match came from family or school, say why in one small line
    let why = null;
    if (key) {
      const fam = (p.family || []).find(f => hit(f.name));
      const sch = schoolsOf(p).find(o => hit(o.name));
      if (fam && !hit(full) && !hit(p.nickname || "")) why = el("span", { class: "fb-why" }, "👪 ", el("i", { text: relName(fam.relation) + " " }), mark(fam.name));
      else if (sch && !hit(full)) why = el("span", { class: "fb-why" }, "🏫 ", mark(sch.name));
    }
    const msgBtn = self ? null : el("button", { class: "fb-msg", type: "button", title: L().contact_member, "aria-label": L().contact_member,
      onclick: e => { e.preventDefault(); openThread({ noticeId: null, other: p.id, title: p.display_name }); } });
    if (msgBtn) msgBtn.innerHTML = MSG_ICON;
    return el("div", { class: "member fb-row" },
      el("a", { class: "member-link", href: "#member-" + p.id }, avatar(p, "fb-av"),
        el("span", { class: "fb-text" },
          el("b", { class: "fb-name" }, mark(full), p.nickname ? el("span", { class: "nick" }, " “", mark(p.nickname), "”") : null, foundingStar(p)),
          place ? el("span", { class: "fb-sub" }, mark(place)) : null,
          why)),
      msgBtn);
  }

  async function loadRecent() {}

  /* ---------- Search and results ---------- */
  function renderResults() {
    const r = lastResults;
    $("results").hidden = false;
    $("res-title").textContent = r.title || L().res_title(r.q);
    const found = (r.members || []).filter(notBlocked);
    $("res-members").replaceChildren(...(found.length ? found.map(p => memberRow(p, clean(r.q)))
      : [el("p", { class: "empty", text: r.mine ? L().town_first(r.town) : L().search_none })]), ...(r.q ? [alertOffer(r.q, r.town, !found.length)] : []));
  }
  /* ---------- Landing page for visitors: search first, then log in or join ---------- */
  var pendingSearch = null;   // what a visitor searched, run for real after they log in
  $("land-form").addEventListener("submit", async e => {
    e.preventDefault();
    const q = $("ls-name").value.trim(), key = clean(q), town = $("ls-town").value, box = $("land-result");
    if (key.length < 2 && !town) { box.hidden = false; box.className = "land-result warn"; box.textContent = L().search_short; $("ls-name").focus(); return; }
    pendingSearch = { q, town };
    let n = null;
    if (sb) { const { data, error } = await sb.rpc("search_count", { p_key: key, p_town: town || null }); if (!error && data != null) n = Number(data); }
    const label = q || town;
    box.hidden = false; box.className = "land-result";
    const msg = n == null ? L().land_some(label) : n > 0 ? L().land_found(n, q, town) : L().land_none(label);
    box.replaceChildren(el("p", { class: "land-msg", text: msg }),
      el("div", { class: "land-btns" },
        el("button", { class: "btn red", type: "button", text: L().login_btn, onclick: () => openAuth(null, "login") }),
        el("a", { class: "btn dark", href: "#register", text: L().land_join })));
  });
  function runPendingSearch() {
    if (!pendingSearch || !me) return;
    const ps = pendingSearch; pendingSearch = null;
    $("s-name").value = ps.q; $("s-town").value = ps.town || "";
    lastResults = null; go("#search");
    setTimeout(() => $("search-form").requestSubmit(), 150);
  }
  // On the search page, a member first sees everyone from the town they registered with
  async function showMyTown() {
    if (!sb || !me || !profile || !profile.hometown || lastResults) return;
    const town = profile.hometown;
    const { data, error } = await sb.from("profiles").select(PROFILE_COLS).eq("suspended", false).eq("hometown", town).order("display_name").limit(500);
    if (error || lastResults) return;
    lastResults = { q: "", town, notices: [], members: (data || []).filter(p => p.id !== me.id), title: L().res_town(town), mine: true };
    renderResults();
  }
  $("search-form").addEventListener("submit", async e => {
    e.preventDefault();
    say("search-msg", "");
    if (curHash === "#join") route();
    if (!needDb("search-msg")) return;
    if (!me) { say("search-msg", L().search_login); openAuth(null, "login"); return; }
    const q = $("s-name").value.trim(), key = clean(q), town = $("s-town").value;
    if (key.length < 2 && !town) { say("search-msg", L().search_short, true); $("s-name").focus(); return; }
    // a name is optional when a hometown is picked: then everyone from that town is listed
    let mq = sb.from("profiles").select(PROFILE_COLS).eq("suspended", false).order("display_name").limit(key.length >= 2 ? 100 : 500);
    if (key.length >= 2) mq = mq.or(`name_key.ilike.%${key}%,family_key.ilike.%${key}%,place_key.ilike.%${key}%`);
    if (town) mq = mq.eq("hometown", town);
    const { data, error } = await mq;
    if (error) { say("search-msg", L().err, true); return; }
    lastResults = { q, town, notices: [], members: data || [], title: key.length >= 2 ? null : L().res_town(town) };
    renderResults();
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- I know this person ---------- */
  function knowPerson(n) {
    if (!sb) { alert(L().setup); return; }
    if (!me) { openAuth(); return; }
    if (!profile) { openProfile(true); return; }
    openThread({ noticeId: n.id, other: n.author, title: L().about_notice(n.person_name) });
  }

  /* ---------- Log in / register: email + password, email confirmed with a 6-digit code ---------- */
  const USER_RE = /^[a-z0-9._-]{3,20}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // Members without email sign up with their phone number. No text message is sent (free):
  // the phone number becomes a private sign-in name like p15551234567@phone.lakaymwen.co
  const PHONE_DOMAIN = "phone.lakaymwen.co";
  const phoneDigits = (cc, num) => {
    let d = String(num || "").replace(/\D/g, "");
    const c = String(cc || "").replace(/\D/g, "");
    if (!d) return "";
    if (String(num).trim().startsWith("+")) return d;          // they typed the full +country number
    if (c && d.startsWith(c) && d.length > 10) return d;        // country code already included
    return c + d.replace(/^0+/, "");
  };
  const phoneEmail = digits => "p" + digits + "@" + PHONE_DOMAIN;
  const isPhoneEmail = e => String(e || "").endsWith("@" + PHONE_DOMAIN);
  // the log-in box takes an email OR a phone number
  function loginId(v) {
    v = String(v || "").trim().toLowerCase();
    if (v.includes("@")) return v;
    const d = v.replace(/\D/g, "");
    if (d.length < 7) return v;
    // 10 digits without "+": a US/Canada number; otherwise they must include the country code
    const plus = v.startsWith("+"); return phoneEmail(!plus && d.length === 10 ? "1" + d : !plus && d.length === 8 ? "509" + d : d);
  }
  const secretNorm = a => String(a || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Sign-up: ONE box for "email or phone number". A phone number becomes a hidden login address, and the secret question shows.
  const looksPhone = v => { v = String(v || "").trim(); return !!v && !v.includes("@") && /^[+\d\s().-]+$/.test(v) && /\d/.test(v); };
  function regId(v) {
    v = String(v || "").trim();
    if (!looksPhone(v)) return { email: v.toLowerCase() };
    const d = v.replace(/\D/g, "");
    let full = "";
    if (v.startsWith("+")) full = d;
    else if (d.length === 10 && !/^[01]/.test(d)) full = "1" + d;        // US / Canada
    else if (d.length === 8 && !/^0/.test(d)) full = "509" + d;      // Haiti
    else if (d.length >= 11) full = d;                                  // already has the country code
    if (!full) return { needCc: true };
    return { phone: full, email: phoneEmail(full) };
  }
  var usePhone = false;
  function syncIdBox() {
    usePhone = looksPhone($("r-email").value);
    $("r-phone-wrap").hidden = !usePhone;
  }
  $("r-email").addEventListener("input", syncIdBox);
  let registering = false, pendingReg = null, verifyEmail = "", verifyPass = "", verifyTimer = null;
  // Logging in uses a small window; registering has its own page (#join).
  function setJoinTown(town) {
    if (town) { store.set("lkm-town", town); $("r-town").value = town; }
    $("join-town-name").textContent = $("r-town").value || "—";
  }
  function openAuth(town, mode) {
    if (town || mode === "register") {
      if ($("dlg-auth").open) $("dlg-auth").close();
      if (town) setJoinTown(town);
      showRegForm();
      go(town || $("r-town").value ? "#join" : "#register");
      return;
    }
    $("auth-title").textContent = L().auth_signin;
    say("auth-msg", "");
    openDlg("dlg-auth");
    $("l-email").focus();
  }
  $("btn-signin").addEventListener("click", () => openAuth(null, "login"));

  async function doLogin(email, pass, msgId, btn) {
    say(msgId, "");
    if (!needDb(msgId)) return;
    email = loginId(email);
    if (!EMAIL_RE.test(email)) { say(msgId, L().email_or_phone_bad, true); return; }
    if (btn) btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (btn) btn.disabled = false;
    if (error) {
      if (/confirm/i.test(error.message)) {        // registered but never entered the code
        if ($("dlg-auth").open) $("dlg-auth").close();
        verifyPass = pass; showVerify(email, true);
        return;
      }
      say(msgId, /invalid/i.test(error.message) ? L().bad_login : L().err + " (" + error.message + ")", true);
      return;
    }
    if ($("dlg-auth").open) $("dlg-auth").close();
  }
  $("login-form").addEventListener("submit", e => { e.preventDefault(); doLogin($("l-email").value, $("l-pass").value, "auth-msg", e.submitter); });
  $("side-login-form").addEventListener("submit", e => { e.preventDefault(); doLogin($("side-email").value, $("side-pass").value, "side-auth-msg", e.submitter); });

  function showRegForm() {
    $("reg-form").hidden = false; $("verify-step").hidden = true;
    $("reg-step1").hidden = false; $("reg-step2").hidden = true;
    document.querySelector("#join .join-town").hidden = false;
  }
  function showVerify(email, resend) {
    verifyEmail = email;
    $("verify-text").textContent = L().verify_text(email);
    $("reg-form").hidden = true; $("verify-step").hidden = false;
    document.querySelector("#join .join-town").hidden = true;
    $("v-code").value = "";
    if (curHash !== "#join") { if (!$("r-town").value) $("r-town").value = store.get("lkm-town") || TOWNS[0]; go("#join"); }
    say("join-msg", resend ? L().not_confirmed : "");
    if (resend) sb.auth.resend({ type: "signup", email });
    setTimeout(() => $("v-code").focus(), 80);
    // If they tap the button in the email (same browser, another tab), finish here by itself
    clearInterval(verifyTimer);
    verifyTimer = setInterval(async () => {
      if ($("verify-step").hidden) { clearInterval(verifyTimer); return; }
      const { data } = await sb.auth.getSession();
      if (data && data.session) { clearInterval(verifyTimer); finishFromConfirmed(data.session.user); }
    }, 3000);
  }
  // Email already confirmed (button in the email, maybe on another phone): sign in with the password they just chose
  async function tryConfirmedLogin(quiet) {
    const { data: s0 } = await sb.auth.getSession();
    if (s0 && s0.session) { finishFromConfirmed(s0.session.user); return true; }
    if (!verifyEmail || !verifyPass) return false;
    const { data, error } = await sb.auth.signInWithPassword({ email: verifyEmail, password: verifyPass });
    if (!error && data && data.session) { finishFromConfirmed(data.session.user); return true; }
    if (!quiet) say("join-msg", L().verify_click_link, true);
    return false;
  }
  function finishFromConfirmed(user) {
    clearInterval(verifyTimer); verifyPass = "";
    if (profile) { go("#search"); return; }      // the other tab already finished
    registering = true; finishRegistration(user);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("verify-step").hidden && verifyEmail && !me) tryConfirmedLogin(true);
  });

  /* ---------- 👁 Show / hide password on every password box ---------- */
  document.querySelectorAll('input[type="password"]').forEach(inp => {
    const wrap = document.createElement("span"); wrap.className = "pw-wrap";
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    const b = document.createElement("button"); b.type = "button"; b.className = "pw-eye"; b.tabIndex = -1;
    const setIc = shown => { b.innerHTML = shown
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c5 0 8.5 4.3 9.5 6-.4.7-1.3 2-2.6 3.2M6.4 7.6C4.6 8.9 3.2 10.6 2.5 12c1 1.7 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12C3.5 10.3 7 6 12 6s8.5 4.3 9.5 6c-1 1.7-4.5 6-9.5 6s-8.5-4.3-9.5-6z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      b.setAttribute("aria-label", shown ? L().pw_hide : L().pw_show); b.title = b.getAttribute("aria-label"); };
    setIc(false);
    b.addEventListener("click", e => { e.preventDefault(); const show = inp.type === "password"; inp.type = show ? "text" : "password"; setIc(show); inp.focus(); });
    wrap.appendChild(b);
  });
  const prettyPhone = d => d.startsWith("509") && d.length === 11 ? "+509 " + d.slice(3, 7) + " " + d.slice(7)
    : d.startsWith("1") && d.length === 11 ? "+1 " + d.slice(1, 4) + " " + d.slice(4, 7) + " " + d.slice(7) : "+" + d;
  // Sign-up photo (required): show a round preview so people see it worked
  let regPhotoUrl = null;
  $("r-photo").addEventListener("change", async () => {
    const f = $("r-photo").files[0], prev = $("r-photo-preview");
    if (regPhotoUrl) { URL.revokeObjectURL(regPhotoUrl); regPhotoUrl = null; }
    if (!f) { prev.replaceChildren("📷"); prev.classList.remove("has"); return; }
    try { await resizePhoto(f); } catch (e) { $("r-photo").value = ""; prev.replaceChildren("📷"); prev.classList.remove("has"); say("join-msg", L().photo_bad, true); return; }
    regPhotoUrl = URL.createObjectURL(f);
    prev.replaceChildren(el("img", { src: regPhotoUrl, alt: "" })); prev.classList.add("has");
    $("r-photo-btn").querySelector("span").textContent = L().change_photo; $("r-photo-wrap").classList.remove("need"); say("join-msg", "");
  });
  // sign-up is 2 steps: 1 = your account, 2 = about you
  function setRegStep(n) {
    $("reg-step1").hidden = n !== 1; $("reg-step2").hidden = n !== 2;
    const top = $("reg-form").getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    if (n === 2) setTimeout(() => $("r-nick").focus({ preventScroll: true }), 300);
  }
  $("reg-back").addEventListener("click", () => { say("join-msg", ""); setRegStep(1); });
  $("reg-form").addEventListener("submit", async e => {
    e.preventDefault();
    say("join-msg", "");
    const u = $("r-user").value.trim().toLowerCase();
    syncIdBox();
    const rid = regId($("r-email").value), pd = rid.phone || "";
    const email = rid.email || "";
    const bad = (msg, field) => { if ($("reg-step1").contains($(field))) setRegStep(1); say("join-msg", msg, true); $(field).focus(); $("join-msg").scrollIntoView({ behavior: "smooth", block: "center" }); };
    // step 1 (your account), in the order the fields appear
    if (!USER_RE.test(u)) return bad(L().user_bad, "r-user");
    const ap = aboutProblem("r"); if (ap) return bad(ap[0], ap[1]);
    if (usePhone) { if (rid.needCc) return bad(L().phone_cc, "r-email"); if (pd.length < 8 || pd.length > 15) return bad(L().phone_bad, "r-email");
      if (secretNorm($("r-seca").value).length < 2) return bad(L().secret_bad, "r-seca"); }
    else if (!EMAIL_RE.test(email)) return bad(L().email_or_phone_bad, "r-email");
    if ($("r-pass").value.length < 6) return bad(L().pass_short, "r-pass");
    if ($("r-pass").value !== $("r-pass2").value) return bad(L().pass_mismatch, "r-pass2");
    if ($("reg-step2").hidden) {   // still on step 1: check the username is free, then go to step 2
      if (sb) { const { data: free1 } = await sb.rpc("username_available", { u }); if (free1 === false) return bad(L().user_taken, "r-user"); }
      if (usePhone && !window.confirm(L().phone_confirm(prettyPhone(pd)))) { $("r-email").focus(); return; }
      setRegStep(2); return;
    }
    // step 2 (about you)
    const bday = readBday("r"); if (bday === false) return bad(L().bday_bad, "r-bmonth");
    if (!$("r-photo").files[0]) { say("join-msg", L().photo_req, true); $("r-photo-wrap").scrollIntoView({ behavior: "smooth", block: "center" }); $("r-photo-wrap").classList.add("need"); return; }
    $("r-photo-wrap").classList.remove("need");
    const lp = livesProblem("r"); if (lp) return bad(lp[0], lp[1]);
    if (!$("r-terms").checked) return bad(L().terms_req, "r-terms");
    if (!needDb("join-msg")) return;
    const btn = e.submitter; if (btn) btn.disabled = true;
    const done = () => { if (btn) btn.disabled = false; };
    const { data: free } = await sb.rpc("username_available", { u });
    if (free === false) { done(); return bad(L().user_taken, "r-user"); }
    registering = true;
    if (me) { await sb.auth.signOut(); me = null; profile = null; }
    const about = Object.assign(readAbout("r"), { listed: $("r-listed").checked,
      founding: $("r-founding").checked, old_username: $("r-founding").checked ? ($("r-old").value.trim() || null) : null,
      accepted_terms_at: new Date().toISOString() });
    const { data, error } = await sb.auth.signUp({ email, password: $("r-pass").value,
      options: { emailRedirectTo: pageUrl(), data: { username: u, profile: about, lang, birthday: bday || null } } });
    done();
    if (error) {
      registering = false;
      if (/already|registered|exists/i.test(error.message)) return bad(usePhone ? L().phone_taken : L().email_taken, "r-email");
      return bad(L().err + " (" + error.message + ")", "r-email");
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { registering = false; return bad(usePhone ? L().phone_taken : L().email_taken, "r-email"); }
    verifyPass = $("r-pass").value;
    pendingReg = { username: u, about, photo: $("r-photo").files[0] || null, birthday: bday || null };
    // keep a small copy of the photo, so it isn't lost if they confirm from the email link in another tab
    if (pendingReg.photo) { try { const b = await resizePhoto(pendingReg.photo);
      store.set("lkm-pending-photo", await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b); })); } catch (e) {} }
    if (data.session && usePhone) {   // save the secret question so they can reset their own password later
      const { error: rErr } = await sb.rpc("set_phone_recovery", { p_question: $("r-secq").value, p_answer: secretNorm($("r-seca").value) });
      if (rErr) console.warn("secret question not saved", rErr.message);
    }
    if (data.session) return finishRegistration(data.session.user);   // email confirmation turned off
    if (usePhone) { registering = false; return bad(L().phone_unavailable, "r-email"); }   // phone sign-up needs "Confirm email" off
    showVerify(email, false);
  });

  $("verify-form").addEventListener("submit", async e => {
    e.preventDefault();
    const token = $("v-code").value.replace(/\D/g, "");
    if (!token) {   // no code typed: maybe they already tapped the button in the email
      const btn = e.submitter; if (btn) btn.disabled = true;
      await tryConfirmedLogin(false);
      if (btn) btn.disabled = false;
      return;
    }
    if (!/^\d{6,10}$/.test(token)) { say("join-msg", L().bad_code, true); $("v-code").focus(); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    registering = true;
    let { data, error } = await sb.auth.verifyOtp({ email: verifyEmail, token, type: "signup" });
    if (error || !data || !data.session) ({ data, error } = await sb.auth.verifyOtp({ email: verifyEmail, token, type: "email" }));
    if (error || !data || !data.session) {
      // the code may be used up because they already tapped the button in the email: then just sign them in
      registering = false;
      const ok = await tryConfirmedLogin(true);
      if (btn) btn.disabled = false;
      if (!ok) { say("join-msg", L().bad_code, true); $("v-code").focus(); }
      return;
    }
    if (btn) btn.disabled = false;
    finishRegistration(data.session.user);
  });
  $("v-resend").addEventListener("click", async () => {
    if (!verifyEmail) return;
    await sb.auth.resend({ type: "signup", email: verifyEmail });
    say("join-msg", L().code_resent);
  });
  $("v-change").addEventListener("click", () => { showRegForm(); say("join-msg", ""); $("r-email").focus(); });

  // Create the profile once the email is confirmed (also when the code is entered later, after logging in)
  var finishingReg = false;
  async function finishRegistration(user) {
    if (finishingReg) return; finishingReg = true;
    try { await finishRegistrationNow(user); } finally { finishingReg = false; }
  }
  async function finishRegistrationNow(user) {
    me = user;
    const meta = user.user_metadata || {};
    const src = pendingReg || { username: meta.username, about: meta.profile || {}, photo: null, birthday: meta.birthday || null };
    let photo_url = null;
    if (src.photo) { try { photo_url = await uploadPhoto(await resizePhoto(src.photo)); } catch (err) { photo_url = null; } }
    if (!photo_url && store.get("lkm-pending-photo")) {
      try { photo_url = await uploadPhoto(await (await fetch(store.get("lkm-pending-photo"))).blob()); } catch (err) { photo_url = null; }
    }
    store.set("lkm-pending-photo", null);
    const row = Object.assign({}, src.about, { id: user.id, username: src.username || null, photo_url });
    if (!row.hometown) row.hometown = $("r-town").value || store.get("lkm-town") || "";
    let { data: prof, error } = await sb.from("profiles").upsert(row).select().single();
    if (error && /duplicate|unique/i.test(error.message)) {          // username taken in the meantime
      row.username = (row.username || "member").slice(0, 16) + Math.floor(100 + Math.random() * 900);
      ({ data: prof, error } = await sb.from("profiles").upsert(row).select().single());
    }
    registering = false; pendingReg = null;
    if (error) { say("join-msg", L().err + " (" + error.message + ")", true); return; }
    profile = prof; store.set("lkm-town", null);
    if (src.birthday && src.birthday.month) { try { await saveBday(src.birthday); } catch (e) {} }
    $("reg-form").reset(); $("r-family").replaceChildren(); $("r-schools").replaceChildren(); ensureSchoolRow("r"); showRegForm();
    go("#member-" + user.id);
    afterAuth();
    openPostcard();
  }
  /* After a new member registers: a postcard to share, then the member search */
  const siteLink = () => "https://lakaymwen.co";   // shares always point to the real site
  function openPostcard() {
    openDlg("dlg-welcome");
  }
  $("pc-card").addEventListener("click", e => { e.preventDefault(); shareSheet(L().pc_share, siteLink()); });
  $("pc-share").addEventListener("click", () => shareSheet(L().pc_share, siteLink()));
  // only the member closing the postcard (X or the button) takes them to Member search
  var navClosing = false;
  $("dlg-welcome").addEventListener("close", () => { if (!navClosing) go("#search"); });

  /* ---------- Forgot password: code by email, then a new password ---------- */
  var forgotEmail = "", recoveryMode = false;
  $("dlg-forgot").addEventListener("close", () => { recoveryMode = false; });
  // The reset email's link brings the member back here already signed in: just ask for the new password
  function openRecovery() {
    recoveryMode = true;
    $("forgot-form").hidden = true; $("reset-form").hidden = false; say("forgot-msg", "");
    $("f-code-wrap").hidden = true;
    $("reset-text").textContent = L().reset_link_text;
    if (!$("dlg-forgot").open) openDlg("dlg-forgot");
    setTimeout(() => $("f-pass").focus(), 60);
  }
  function openForgot() {
    recoveryMode = false; $("f-code-wrap").hidden = false;
    $("forgot-form").hidden = false; $("reset-form").hidden = true; $("phone-reset-form").hidden = true; say("forgot-msg", "");
    $("f-email").value = ($("l-email").value || $("side-email").value || "").trim();
    if ($("dlg-auth").open) $("dlg-auth").close();
    openDlg("dlg-forgot"); $("f-email").focus();
  }
  document.querySelectorAll("[data-forgot], [data-forgot-menu]").forEach(b => b.addEventListener("click", openForgot));
  $("forgot-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!needDb("forgot-msg")) return;
    const email = loginId($("f-email").value);
    if (isPhoneEmail(email)) {   // phone members answer their secret question instead of getting an email
      const btn = e.submitter; if (btn) btn.disabled = true;
      const { data: q, error } = await sb.rpc("phone_recovery_question", { p_email: email });
      if (btn) btn.disabled = false;
      if (error || !q || !L()["q_" + q]) { say("forgot-msg", L().phone_forgot((C.CONTACT_EMAIL || "info@lakaymwen.co")), true); return; }
      forgotEmail = email;
      $("ps-q").textContent = L()["q_" + q];
      ["ps-a", "ps-pass", "ps-pass2"].forEach(id => { $(id).value = ""; });
      $("forgot-form").hidden = true; $("phone-reset-form").hidden = false; say("forgot-msg", "");
      $("ps-a").focus();
      return;
    }
    if (!EMAIL_RE.test(email)) { say("forgot-msg", L().email_or_phone_bad, true); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl() });
    if (btn) btn.disabled = false;
    if (error) { say("forgot-msg", L().err + " (" + error.message + ")", true); return; }
    forgotEmail = email;
    $("reset-text").textContent = L().reset_text(email);
    $("forgot-form").hidden = true; $("reset-form").hidden = false; say("forgot-msg", "");
    $("f-code").focus();
  });
  $("phone-reset-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (secretNorm($("ps-a").value).length < 2) { say("forgot-msg", L().secret_bad, true); $("ps-a").focus(); return; }
    if ($("ps-pass").value.length < 6) { say("forgot-msg", L().pass_short, true); $("ps-pass").focus(); return; }
    if ($("ps-pass").value !== $("ps-pass2").value) { say("forgot-msg", L().pass_mismatch, true); $("ps-pass2").focus(); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { data: r, error } = await sb.rpc("phone_reset_password", { p_email: forgotEmail, p_answer: secretNorm($("ps-a").value), p_password: $("ps-pass").value });
    if (error || r !== "ok") {
      if (btn) btn.disabled = false;
      const t = error ? L().err + " (" + error.message + ")" : r === "wrong" ? L().secret_wrong : r === "locked" ? L().secret_locked : r === "short" ? L().pass_short : L().phone_forgot((C.CONTACT_EMAIL || "info@lakaymwen.co"));
      say("forgot-msg", t, true); return;
    }
    // new password saved: log them straight in
    const { error: sErr } = await sb.auth.signInWithPassword({ email: forgotEmail, password: $("ps-pass").value });
    if (btn) btn.disabled = false;
    $("phone-reset-form").hidden = true; say("forgot-msg", sErr ? L().pass_changed : L().pass_changed);
    setTimeout(() => $("dlg-forgot").close(), 1400);
  });
  $("reset-form").addEventListener("submit", async e => {
    e.preventDefault();
    const token = $("f-code").value.replace(/\D/g, "");
    if (!recoveryMode && !token) { say("forgot-msg", L().reset_click_link, true); return; }
    if (!recoveryMode && !/^\d{6,10}$/.test(token)) { say("forgot-msg", L().bad_code, true); return; }
    if ($("f-pass").value.length < 6) { say("forgot-msg", L().pass_short, true); return; }
    if ($("f-pass").value !== $("f-pass2").value) { say("forgot-msg", L().pass_mismatch, true); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    if (!recoveryMode) {
      const { data, error } = await sb.auth.verifyOtp({ email: forgotEmail, token, type: "recovery" });
      if (error || !data.session) { if (btn) btn.disabled = false; say("forgot-msg", L().bad_code, true); return; }
    }
    const { error: uErr } = await sb.auth.updateUser({ password: $("f-pass").value });
    if (btn) btn.disabled = false;
    if (uErr) { say("forgot-msg", L().err + " (" + uErr.message + ")", true); return; }
    recoveryMode = false;
    $("reset-form").hidden = true; say("forgot-msg", L().pass_changed);
    setTimeout(() => $("dlg-forgot").close(), 1400);
  });
  $("btn-signout").addEventListener("click", async () => { if (sb) { await forgetPushSub(); await sb.auth.signOut(); } });
  $("join-logout").addEventListener("click", async () => { if (sb) await sb.auth.signOut(); });

  function updateAccount() {
    $("acct-out").hidden = !!me;
    $("acct-in").hidden = !me;
    document.body.classList.toggle("logged-in", !!me);
  }
  /* ---------- 🔔 Phone notifications (free web push): the phone buzzes when a message or friend request arrives ---------- */
  const VAPID_PUBLIC = "BJr6Xyp60l6h-Xmot-P08T7QkoDdzzvpoOYwGmqVzZdRiVwQHjGwVN3PZQwuJW7JvishnMdHlcIrVue1Ma0AR2Q";
  const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const pushStandalone = window.matchMedia && matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const b64key = k => { const p = "=".repeat((4 - k.length % 4) % 4), b = atob((k + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  async function savePushSub() {
    if (!pushOK || !sb || !me || Notification.permission !== "granted") return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(VAPID_PUBLIC) });
      const j = sub.toJSON();
      const { error } = await sb.from("push_subs").upsert({ endpoint: j.endpoint, user_id: me.id, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      return !error;
    } catch (e) { return false; }
  }
  async function forgetPushSub() {   // on sign out: this phone stops getting this member's alerts
    try { if (!pushOK || !sb) return; const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); } catch (e) {}
  }
  function renderPushBox() {
    const box = $("push-box"); if (!box) return;
    const later = Number(store.get("lkm-push-later") || 0) > Date.now();
    const close = () => { store.set("lkm-push-later", String(Date.now() + 7 * 864e5)); box.hidden = true; };
    const x = el("button", { class: "push-x", type: "button", "aria-label": L().close || "Close", text: "×", onclick: close });
    if (!me || later) { box.hidden = true; return; }
    if (isIOS && !pushStandalone) {   // iPhone: alerts only work from the home-screen icon
      box.replaceChildren(el("span", { class: "push-ic", text: "📲" }), el("div", { class: "push-txt" }, el("b", { text: L().push_h }), el("span", { text: L().push_ios })), x);
      box.hidden = false; return;
    }
    if (!pushOK || Notification.permission !== "default") { box.hidden = true; return; }
    const msg = el("small", { class: "push-msg", hidden: "" });
    const go = el("button", { class: "btn red small", type: "button", text: L().push_btn, onclick: async () => {
      go.disabled = true;
      let perm = "default"; try { perm = await Notification.requestPermission(); } catch (e) {}
      if (perm === "granted" && await savePushSub()) { box.replaceChildren(el("span", { class: "push-ic", text: "✅" }), el("div", { class: "push-txt" }, el("b", { text: L().push_on }))); setTimeout(() => { box.hidden = true; }, 3500); }
      else { go.disabled = false; msg.hidden = false; msg.textContent = perm === "denied" ? L().push_denied : L().push_fail; }
    } });
    box.replaceChildren(el("span", { class: "push-ic", text: "🔔" }), el("div", { class: "push-txt" }, el("b", { text: L().push_h }), el("span", { text: L().push_p }), msg), go, x);
    box.hidden = false;
  }
  async function afterAuth() {
    updateAccount(); loadSchoolOpts();
    myLinks = null; hideHC();
    if (!me) { if ($("push-box")) $("push-box").hidden = true; lastResults = null; $("results").hidden = true; profile = null; blockedIds = new Set(); isAdmin = false; schoolData = null; document.body.classList.remove("is-admin"); $("unread").hidden = true; $("unread-side").hidden = true; showMsgAlert(0); pymkData = null; renderPymk(); bdayData = null; myBday = null; renderBirthdays(); updateSide(); loadFeatured(); loadTownCounts(); refreshAlerts(); if (curHash === "#join" || pageFor(curHash)) route(); if (currentMember) renderMemberPage(currentMember); return; }
    const { data } = await sb.from("profiles").select("*").eq("id", me.id).maybeSingle();
    profile = data || null; schoolData = null;
    say("search-msg", "");
    const [{ data: bl }, { data: adm }] = await Promise.all([sb.from("blocks").select("blocked"), sb.rpc("is_admin")]);
    blockedIds = new Set((bl || []).map(b => b.blocked));
    isAdmin = adm === true; document.body.classList.toggle("is-admin", isAdmin);
    updateSide(); loadFeatured(); loadTownCounts();
    if (curHash === "#search" || !curHash || curHash === "#home") showMyTown();
    runPendingSearch();
    if (curHash === "#admin") renderAdmin();
    if (currentMember) renderMemberPage(currentMember);
    if (!profile && !registering && me.user_metadata && me.user_metadata.profile) { finishRegistration(me); return; }
    if (!profile && !registering) openProfile(true);
    refreshUnread(); refreshAlerts(); syncLangMeta(); loadPymk(); loadBirthdays();
    renderPushBox(); savePushSub();
    if (pageFor(curHash)) route();
  }
  // Remember the member's language so alert emails come in Kreyòl or English
  function syncLangMeta() {
    if (sb && me && (me.user_metadata || {}).lang !== lang) sb.auth.updateUser({ data: { lang } }).catch(() => {});
  }

  /* ---------- Birthdays: month + day only, private; friends and family get a reminder ---------- */
  let bdayData = null, myBday = null;
  const daysIn = m => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  function fillBdaySelects(p) {
    const ms = $(p + "-bmonth"), ds = $(p + "-bday"); if (!ms || !ds) return;
    const mv = ms.value, dv = ds.value;
    ms.replaceChildren(el("option", { value: "", text: L().bday_month }),
      ...Array.from({ length: 12 }, (_, i) => el("option", { value: String(i + 1),
        text: new Date(2000, i, 15).toLocaleDateString(locale(), { month: "long" }).replace(/^./, c => c.toUpperCase()) })));
    ds.replaceChildren(el("option", { value: "", text: L().bday_day }),
      ...Array.from({ length: 31 }, (_, i) => el("option", { value: String(i + 1), text: String(i + 1) })));
    ms.value = mv; ds.value = dv;
  }
  function setBday(p, b) { fillBdaySelects(p); $(p + "-bmonth").value = b ? String(b.month) : ""; $(p + "-bday").value = b ? String(b.day) : ""; }
  // null = nothing chosen, false = half filled or impossible date, else { month, day }
  function readBday(p) {
    const m = Number($(p + "-bmonth").value), d = Number($(p + "-bday").value);
    if (!m && !d) return null;
    if (!m || !d || d > daysIn(m)) return false;
    return { month: m, day: d };
  }
  async function saveBday(b) {
    if (!sb || !me) return;
    if (b) await sb.from("birthdays").upsert({ user_id: me.id, month: b.month, day: b.day, updated_at: new Date().toISOString() });
    else await sb.from("birthdays").delete().eq("user_id", me.id);
    myBday = b || null;
  }
  function todayMD() {
    const t = new Date(), y = t.getFullYear();
    const leapYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return { month: t.getMonth() + 1, day: t.getDate(), leap: t.getMonth() === 1 && t.getDate() === 28 && !leapYear };
  }
  async function loadBirthdays() {
    bdayData = null; myBday = null;
    if (sb && me) {
      const t = todayMD();
      const [{ data: mine }, { data: ids }] = await Promise.all([
        sb.from("birthdays").select("month,day").eq("user_id", me.id).maybeSingle(),
        sb.rpc("birthdays_today", { p_month: t.month, p_day: t.day, p_leap: t.leap })]);
      myBday = mine || null;
      const list = (ids || []).map(r => r.id).filter(id => !blockedIds.has(id));
      const { data: people } = list.length ? await sb.from("profiles").select(PROFILE_COLS).in("id", list) : { data: [] };
      bdayData = people || [];
    }
    renderBirthdays();
  }
  function renderBirthdays() {
    const box = $("bday-box"); if (!box) return;
    const t = todayMD();
    const mineToday = !!(me && myBday && ((myBday.month === t.month && myBday.day === t.day) || (t.leap && myBday.month === 2 && myBday.day === 29)));
    const list = me ? (bdayData || []) : [];
    box.hidden = !me || (!list.length && !mineToday);
    if (box.hidden) return;
    $("bday-mine").hidden = !mineToday;
    if (mineToday) $("bday-mine").textContent = L().bday_mine((profile && (profile.first_name || profile.display_name)) || "");
    $("bday-p").hidden = !list.length;
    $("bday-list").replaceChildren(...list.map(p => el("div", { class: "bday-card" },
      el("a", { class: "bday-who", href: "#member-" + p.id }, avatar(p), el("b", {}, p.display_name, foundingStar(p))),
      el("button", { class: "btn small red", type: "button", text: L().bday_send, onclick: async () => {
        await openThread({ noticeId: null, other: p.id, title: p.display_name });
        const r = $("reply-body"); if (r && !r.value) { r.value = L().bday_wish(p.first_name || p.display_name); r.focus(); }
      } }))));
  }

  /* ---------- Banner slideshow, like the old Flash banner: Haiti photos, "Welcome to", then the logo ---------- */
  (function heroShow() {
    const show = $("hb-show"); if (!show) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { show.className = "hb-show"; return; }   // calm version: logo only
    const slides = [...show.querySelectorAll(".hb-slide")], ready = new Set(), welcome = show.querySelector(".hb-welcome");
    slides.forEach(sl => { const im = new Image(); im.onload = () => { const bg = document.createElement("div"); bg.className = "hb-img"; bg.style.backgroundImage = `url("${im.src}")`; sl.prepend(bg); ready.add(sl); }; im.src = sl.dataset.src; });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const visible = () => new Promise(r => { if (!document.hidden) return r(); document.addEventListener("visibilitychange", function f() { if (!document.hidden) { document.removeEventListener("visibilitychange", f); r(); } }); });
    async function loop() {
      // opening: "Welcome to" on its own, over the first Haiti photo, for 2 seconds (no logo yet)
      show.classList.add("intro", "on"); welcome.classList.add("on");   // already on in the page, so it shows instantly
      for (let t = 0; t < 12 && !ready.size; t++) await wait(250);         // wait up to 3 s for the first photo
      let prev = null, round = 0;
      const next = sl => { sl.classList.add("on"); if (prev && prev !== sl) prev.classList.remove("on"); prev = sl; };
      if (ready.size) { next(slides.find(sl => ready.has(sl))); welcome.classList.add("photo"); }
      await wait(2000);
      if (!ready.size) { welcome.classList.remove("on"); show.classList.remove("on"); await wait(1200); show.classList.remove("intro"); return; }   // no photos: keep the drawn scene
      if (!prev) next(slides.find(sl => ready.has(sl)));
      welcome.classList.remove("on");
      await wait(500);
      show.classList.remove("intro"); welcome.classList.remove("photo");   // the logo appears on top of the photos
      await wait(4500);
      for (;;) {
        await visible();
        for (const sl of slides.filter(x => ready.has(x))) {
          if (sl === prev) continue;
          next(sl); await wait(5000);
        }
        round++;
        if (round % 2 === 0) { welcome.classList.add("on"); await wait(3200); welcome.classList.remove("on"); }   // now and then, "Welcome to" beside the logo
        prev && prev.classList.remove("on"); prev = null;
        const first = slides.find(x => ready.has(x)); next(first); await wait(5000);
      }
    }
    loop();
  })();

  /* ---------- Groove FM live radio (sponsor) ---------- */
  const GROOVE = typeof C.GROOVE_STREAM_URL === "string" && /^https:\/\//.test(C.GROOVE_STREAM_URL.trim()) ? C.GROOVE_STREAM_URL.trim() : "";
  let grooveState = "idle";   // idle | loading | playing
  function grooveUI() {
    const btn = $("groove-play"); if (!btn) return;
    btn.classList.toggle("playing", grooveState === "playing");
    btn.classList.toggle("loading", grooveState === "loading");
    btn.querySelector(".gp-icon").textContent = grooveState === "playing" ? "❚❚" : "▶";
    $("groove-label").textContent = grooveState === "playing" ? L().groove_pause : grooveState === "loading" ? L().groove_loading : L().groove_listen;
    btn.setAttribute("aria-pressed", String(grooveState !== "idle"));
  }
  (function grooveSetup() {
    const btn = $("groove-play"), audio = $("groove-audio"); if (!btn || !audio || !GROOVE) return;   // no stream yet: the button opens the website
    btn.removeAttribute("target"); btn.setAttribute("href", "#groove");
    btn.addEventListener("click", async ev => {
      ev.preventDefault(); $("groove-msg").hidden = true;
      if (grooveState !== "idle") { audio.pause(); audio.removeAttribute("src"); audio.load(); grooveState = "idle"; grooveUI(); return; }
      grooveState = "loading"; grooveUI();
      audio.src = GROOVE + (GROOVE.includes("?") ? "&" : "?") + "t=" + Date.now();   // always join the live broadcast, not an old buffer
      try {
        await audio.play();
        if ("mediaSession" in navigator && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: "Groove FM Radio", artist: "Live · Lakaymwen.co",
          artwork: [{ src: new URL("sponsor-groovefm.png", location.href).href, sizes: "600x269", type: "image/png" }] });
      } catch (e) { grooveFail(); }
    });
    audio.addEventListener("playing", () => { grooveState = "playing"; grooveUI(); });
    audio.addEventListener("waiting", () => { if (grooveState === "playing") { grooveState = "loading"; grooveUI(); } });
    audio.addEventListener("error", () => { if (grooveState !== "idle") grooveFail(); });
    function grooveFail() {
      audio.pause(); audio.removeAttribute("src"); grooveState = "idle"; grooveUI();
      const m = $("groove-msg"); m.replaceChildren(L().groove_err.replace(/[^.!]*$/, "") + " ", el("a", { href: "https://radiogroovefm.com", target: "_blank", rel: "noopener", text: "radiogroovefm.com" })); m.hidden = false;
    }
  })();

  /* ---------- Special days: the banner celebrates Haitian holidays ---------- */
  function easter(y) {   // Gregorian Easter Sunday
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function lastSunday(y, m) { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - d.getDay()); return d; }
  function specialDay(date) {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    const same = x => x.getMonth() === date.getMonth() && x.getDate() === d;
    if (m === 1 && d === 1) return "indep";
    if (m === 1 && d === 2) return "ancestors";
    if (m === 5 && d === 18) return "flag";
    if (m === 11 && d === 18) return "vertieres";
    if (m === 12 && (d === 24 || d === 25)) return "christmas";
    const e = easter(y);
    for (const back of [49, 48, 47]) { const c = new Date(e); c.setDate(c.getDate() - back); if (same(c)) return "carnival"; }
    if (same(lastSunday(y, 4))) return "mother";   // Haiti: last Sunday of May
    if (same(lastSunday(y, 5))) return "father";   // Haiti: last Sunday of June
    return null;
  }
  function applySpecialDay() {
    const banner = document.querySelector(".hero-banner"); if (!banner) return;
    let date = new Date();
    const q = (new URLSearchParams(location.search).get("day") || "").match(/^(\d{1,2})-(\d{1,2})$/);   // preview: ?day=05-18
    if (q) date = new Date(date.getFullYear(), Number(q[1]) - 1, Number(q[2]));
    const key = specialDay(date);
    banner.classList.remove("sd", "sd-patriot", "sd-carnival", "sd-christmas", "sd-family");
    const k = document.querySelector(".hb-kicker");
    if (!key) { if (k) k.textContent = L().since; return; }
    banner.classList.add("sd", ["indep", "ancestors", "flag", "vertieres"].includes(key) ? "sd-patriot" : key === "carnival" ? "sd-carnival" : key === "christmas" ? "sd-christmas" : "sd-family");
    if (k) k.textContent = L()["sd_" + key];
  }

  /* ---------- Profile / my account ---------- */
  async function openProfile(isNew) {
    if (!me) { openAuth(); return; }
    fillAbout("pr", profile);
    setBday("pr", myBday);
    if (sb) sb.from("birthdays").select("month,day").eq("user_id", me.id).maybeSingle().then(({ data }) => { myBday = data || null; setBday("pr", myBday); });
    $("pr-listed").checked = profile ? profile.listed : true;
    $("pr-founding").checked = !!profile?.founding; $("pr-old").value = profile?.old_username || "";
    $("pr-old-wrap").hidden = !$("pr-founding").checked;
    $("del-confirm").hidden = true; $("del-start").hidden = !profile; $("del-word").value = ""; say("del-msg", "");
    pendingPhoto = null; removePhoto = false; $("pr-photo").value = "";
    showPhotoPreview(profile);
    say("profile-msg", isNew ? L().welcome : "");
    openDlg("dlg-profile");
    if ($("my-notices-wrap")) $("my-notices-wrap").hidden = true;
    return;
    const { data } = await sb.from("notices").select("*").eq("author", me.id).order("created_at", { ascending: false });
    if (data && data.length) {
      $("my-notices-wrap").hidden = false;
      $("my-notices").replaceChildren(...data.map(n => el("div", { class: "member" },
        el("div", {}, el("b", { text: n.person_name }), el("span", { class: "meta", text: `${n.hometown} · ${fmtDate(n.created_at)}` })),
        el("button", { class: "btn small ghost", type: "button", text: L().remove, onclick: async ev => {
          const { error } = await sb.from("notices").delete().eq("id", n.id);
          if (!error) { ev.target.closest(".member").remove(); loadRecent(); loadTownCounts(); }
        } }))));
    }
  }
  $("btn-mine").addEventListener("click", () => openProfile(false));
  let pendingPhoto = null, removePhoto = false, previewUrl = null;
  function showPhotoPreview(p) {
    $("pr-photo-preview").replaceChildren(avatar(p || { display_name: (($("pr-first").value + " " + $("pr-last").value).trim()) || (profile && profile.display_name) }, "lg"));
    $("pr-photo-remove").hidden = true;   // a photo is required: members can change it, not remove it
  }
  $("pr-photo").addEventListener("change", async () => {
    const f = $("pr-photo").files[0]; if (!f) return;
    try {
      pendingPhoto = await resizePhoto(f); removePhoto = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(pendingPhoto);
      showPhotoPreview({ display_name: ($("pr-first").value + " " + $("pr-last").value).trim(), photo_url: previewUrl });
      say("profile-msg", "");
    } catch (e) { say("profile-msg", L().photo_bad, true); }
  });
  $("pr-photo-remove").addEventListener("click", () => {
    pendingPhoto = null; removePhoto = true; $("pr-photo").value = "";
    showPhotoPreview({ display_name: ($("pr-first").value + " " + $("pr-last").value).trim() });
  });
  $("profile-form").addEventListener("submit", async e => {
    e.preventDefault();
    const ap = aboutProblem("pr");
    if (ap) { say("profile-msg", ap[0], true); $(ap[1]).focus(); return; }
    const bday = readBday("pr");
    if (bday === false) { say("profile-msg", L().bday_bad, true); $("pr-bmonth").focus(); return; }
    const lpp = livesProblem("pr"); if (lpp) { say("profile-msg", lpp[0], true); $(lpp[1]).focus(); return; }
    if (!pendingPhoto && (removePhoto || !(profile && profile.photo_url))) { say("profile-msg", L().photo_req, true); $("pr-photo-preview").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const row = Object.assign({ id: me.id, username: profile?.username || me.user_metadata?.username || null, listed: $("pr-listed").checked,
      founding: $("pr-founding").checked, old_username: $("pr-founding").checked ? ($("pr-old").value.trim() || null) : null }, readAbout("pr"));
    let photoFailed = false;
    const btn = e.submitter; if (btn) btn.disabled = true;
    if (pendingPhoto) {
      try { row.photo_url = await uploadPhoto(pendingPhoto); } catch (err) { photoFailed = true; }
    } else if (removePhoto) {
      row.photo_url = null;
      sb.storage.from("avatars").remove([me.id + "/avatar.jpg"]);
    }
    const { data, error } = await sb.from("profiles").upsert(row).select().single();
    if (btn) btn.disabled = false;
    if (error) { say("profile-msg", L().err, true); return; }
    pendingPhoto = null; removePhoto = false;
    try { await saveBday(bday); } catch (err) {}
    renderBirthdays();
    const wasNew = !profile;
    profile = data; schoolData = null; store.set("lkm-town", null);
    updateSide(); loadFeatured();
    say("profile-msg", photoFailed ? L().photo_err : L().saved, photoFailed);
    showPhotoPreview(profile);
    if (currentMember) renderMemberPage(currentMember);
    if (wasNew) setTimeout(() => $("dlg-profile").close(), 700);
  });

  /* ---------- Town window ---------- */
  async function openTown(t) {
    $("town-title").textContent = t;
    const reg = $("town-register");
    reg.hidden = !!me;
    reg.textContent = L().register_from(t);
    reg.onclick = () => { $("dlg-town").close(); openAuth(t); };
    $("town-members").replaceChildren(); $("town-katye").hidden = true;
    openDlg("dlg-town");
    if (!sb) { $("town-members").replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { $("town-members").replaceChildren(el("p", { class: "empty", text: L().members_signin })); return; }
    const [{ data: ms }, { data: ks }] = await Promise.all([
      sb.from("profiles").select(PROFILE_COLS).eq("suspended", false).eq("hometown", t).order("display_name").limit(200),
      sb.rpc("katye_counts", { p_town: t })]);
    $("town-katye").hidden = !(ks && ks.length);
    $("town-katye-list").replaceChildren(...(ks || []).map(o => el("a", { class: "chip-link", href: katyeHash(t, o.katye) }, o.katye, el("span", { class: "count", text: String(o.members) }))));
    $("town-members").replaceChildren(...((ms && ms.length) ? ms.map(p => memberRow(p)) : [el("p", { class: "empty", text: L().none_members })]));
  }

  /* ---------- Messages ---------- */
  async function refreshUnread() {
    if (!sb || !me) return;
    const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("recipient", me.id).is("read_at", null);
    $("unread").textContent = count || "";
    $("unread").hidden = !count;
    $("unread-side").textContent = count || "";
    $("unread-side").hidden = !count;
    showMsgAlert(count || 0);
  }
  // The flashing alert goes away as soon as the member opens their messages,
  // and only comes back when a NEW message arrives.
  var unreadNow = 0, msgAck = 0;
  function showMsgAlert(n) {
    const b = $("msg-alert"); if (!b) return;
    unreadNow = n;
    if (n < msgAck) msgAck = n;
    if ($("dlg-inbox") && $("dlg-inbox").open) msgAck = n;
    b.hidden = !n || n <= msgAck;
    $("msg-alert-n").textContent = n ? String(n) : "";
    $("msg-alert-txt").textContent = n ? L().msg_new(n) : "";
    b.setAttribute("aria-label", n ? L().msg_new(n) : "");
    document.title = (n ? "(" + n + ") " : "") + document.title.replace(/^\(\d+\) /, "");
  }
  if ($("msg-alert")) $("msg-alert").addEventListener("click", () => { if (me) openInbox(); });
  async function openInbox() {
    msgAck = unreadNow; showMsgAlert(unreadNow);
    thread = null;
    $("inbox-title").textContent = L().inbox_title;
    $("thread").hidden = true; $("inbox-back").hidden = true; $("thread-list").hidden = false;
    say("inbox-msg", "");
    openDlg("dlg-inbox");
    const { data, error } = await sb.from("messages").select("*")
      .or(`sender.eq.${me.id},recipient.eq.${me.id}`).order("created_at", { ascending: false }).limit(500);
    if (error) { say("inbox-msg", L().err, true); return; }
    const threads = new Map();
    (data || []).forEach(m => {
      const other = m.sender === me.id ? m.recipient : m.sender;
      const key = (m.notice_id || "direct") + "|" + other;
      if (!threads.has(key)) threads.set(key, { noticeId: m.notice_id, other, last: m, unread: false });
      if (m.recipient === me.id && !m.read_at) threads.get(key).unread = true;
    });
    if (!threads.size) { $("thread-list").replaceChildren(el("p", { class: "empty", text: L().no_threads })); return; }
    const list = [...threads.values()].filter(t => !blockedIds.has(t.other));
    if (!list.length) { $("thread-list").replaceChildren(el("p", { class: "empty", text: L().no_threads })); return; }
    const nIds = [...new Set(list.map(t => t.noticeId).filter(Boolean))];
    const pIds = [...new Set(list.map(t => t.other))];
    const [{ data: ns }, { data: ps }] = await Promise.all([
      nIds.length ? sb.from("notices").select("id,person_name").in("id", nIds) : Promise.resolve({ data: [] }),
      sb.from("profiles").select("id,display_name").in("id", pIds)
    ]);
    const nName = Object.fromEntries((ns || []).map(n => [n.id, n.person_name]));
    const pName = Object.fromEntries((ps || []).map(p => [p.id, p.display_name]));
    $("thread-list").replaceChildren(...list.map(t => {
      const who = pName[t.other] || L().a_member;
      const title = t.noticeId ? L().about_notice(nName[t.noticeId] || "…") : who;
      return el("button", { type: "button", class: t.unread ? "unread" : null,
        onclick: () => openThread({ noticeId: t.noticeId, other: t.other, title }) },
        el("b", { text: title }),
        el("div", { class: "meta", text: (t.noticeId ? who + " · " : "") + t.last.body.slice(0, 80) }));
    }));
  }
  $("btn-inbox").addEventListener("click", openInbox);
  $("inbox-back").addEventListener("click", openInbox);

  function threadQuery(q) {
    q = q.or(`and(sender.eq.${me.id},recipient.eq.${thread.other}),and(sender.eq.${thread.other},recipient.eq.${me.id})`);
    return thread.noticeId ? q.eq("notice_id", thread.noticeId) : q.is("notice_id", null);
  }
  async function openThread(t) {
    thread = t;
    $("inbox-title").textContent = t.title;
    $("thread-list").hidden = true; $("thread").hidden = false; $("inbox-back").hidden = false;
    say("inbox-msg", "");
    openDlg("dlg-inbox");
    await loadThread();
    $("reply-body").focus();
  }
  async function loadThread() {
    const { data } = await threadQuery(sb.from("messages").select("*")).order("created_at", { ascending: true }).limit(500);
    const box = $("bubbles");
    box.replaceChildren(...(data || []).map(m => el("div", { class: "bubble" + (m.sender === me.id ? " mine" : "") },
      el("small", { text: (m.sender === me.id ? L().you : "") + (m.sender === me.id ? " · " : "") + fmtDate(m.created_at) }), m.body)));
    box.scrollTop = box.scrollHeight;
    if ((data || []).some(m => m.recipient === me.id && !m.read_at)) {
      await threadQuery(sb.from("messages").update({ read_at: new Date().toISOString() })).eq("recipient", me.id).is("read_at", null);
      refreshUnread();
    }
  }
  $("reply-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = $("reply-body").value.trim();
    if (!body || !thread) return;
    const { error } = await sb.from("messages").insert({ notice_id: thread.noticeId, recipient: thread.other, body });
    if (error) { say("inbox-msg", L().msg_blocked, true); return; }
    $("reply-body").value = "";
    say("inbox-msg", "");
    loadThread();
  });

  ["r", "pr"].forEach(p => $(p + "-founding").addEventListener("change", () => {
    $(p + "-old-wrap").hidden = !$(p + "-founding").checked;
    if ($(p + "-founding").checked) $(p + "-old").focus();
  }));

  /* ---------- Report / block a member ---------- */
  let reportTarget = null;
  let reportPhoto = null;
  function openReport(p, photo) {
    if (!sb) return;
    if (!me) { openAuth(null, "login"); return; }
    reportTarget = p; reportPhoto = photo || null;
    $("report-title").textContent = photo ? L().report_photo : L().report_member(p.display_name);
    $("report-form").hidden = false; $("rep-reason").value = ""; $("rep-details").value = ""; $("rep-block").checked = true;
    say("report-msg", "");
    openDlg("dlg-report");
  }
  $("report-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!$("rep-reason").value) { say("report-msg", L().report_pick_req, true); $("rep-reason").focus(); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { error } = await sb.from("member_reports").insert({ reported: reportTarget.id, reason: $("rep-reason").value,
      details: $("rep-details").value.trim() || null, photo_id: reportPhoto ? reportPhoto.id : null });
    if (!error && $("rep-block").checked) await blockMember(reportTarget.id, true);
    if (btn) btn.disabled = false;
    if (error) { say("report-msg", L().err, true); return; }
    $("report-form").hidden = true;
    say("report-msg", L().reported);
    if (currentMember) renderMemberPage(currentMember);
    if (reportPhoto && pageFor(curHash)) route();
  });
  async function blockMember(id, quiet) {
    const { error } = await sb.from("blocks").insert({ blocked: id });
    if (!error || /duplicate|unique/i.test(error.message || "")) blockedIds.add(id);
    if (!quiet && currentMember) renderMemberPage(currentMember);
    renderFeatured();
  }
  async function unblockMember(id) {
    await sb.from("blocks").delete().eq("blocker", me.id).eq("blocked", id);
    blockedIds.delete(id);
    if (currentMember) renderMemberPage(currentMember);
    renderFeatured();
  }

  /* ---------- Delete my account ---------- */
  $("del-start").addEventListener("click", () => { $("del-confirm").hidden = false; $("del-word").value = ""; $("del-word").focus(); });
  $("del-cancel").addEventListener("click", () => { $("del-confirm").hidden = true; say("del-msg", ""); });
  $("del-go").addEventListener("click", async () => {
    if ($("del-word").value.trim().toUpperCase() !== L().delete_word) { say("del-msg", L().delete_type_req, true); $("del-word").focus(); return; }
    $("del-go").disabled = true;
    try { await sb.storage.from("avatars").remove([me.id + "/avatar.jpg"]); } catch (err) {}
    try {
      const { data: mine } = await sb.from("photos").select("path").eq("owner", me.id);
      if (mine && mine.length) await sb.storage.from("photos").remove(mine.map(x => x.path));
    } catch (err) {}
    const { error } = await sb.rpc("delete_my_account");
    $("del-go").disabled = false;
    if (error) { say("del-msg", L().err + " (" + error.message + ")", true); return; }
    await sb.auth.signOut();
    $("dlg-profile").close();
    go("#home");
    say("side-auth-msg", L().deleted);
  });

  /* ---------- Privacy page ---------- */
  function renderPrivacy() {
    const box = $("privacy-body"); if (!box) return;
    box.replaceChildren(...(L().privacy_sections || []).map(([h, p]) => el("section", {}, el("h3", { text: h }), el("p", { text: p.replace("{email}", C.CONTACT_EMAIL || "") }))));
  }

  /* ---------- Admin page (only for admins) ---------- */
  const REASONS = ["fake", "scam", "harass", "photo", "minor", "other"];
  // Admin: new password for a member who signed up with a phone number (they have no email to reset it)
  function phoneResetBox() {
    const msg = el("p", { class: "msg", hidden: "" });
    const cc = el("select", { "aria-label": "Country code" }, ...[["1","🇺🇸 +1"],["509","🇭🇹 +509"],["33","🇫🇷 +33"],["56","🇨🇱 +56"],["55","🇧🇷 +55"],["52","🇲🇽 +52"],["34","🇪🇸 +34"],["44","🇬🇧 +44"],["590","🇬🇵 +590"],["596","🇲🇶 +596"],["594","🇬🇫 +594"]].map(([v, t]) => el("option", { value: v, text: t })));
    const ph = el("input", { type: "tel", inputmode: "tel", placeholder: "347 555 1234", "aria-label": L().phone_lbl });
    const pw = el("input", { type: "text", placeholder: L().new_pass, autocomplete: "off", "aria-label": L().new_pass });
    const go = el("button", { class: "btn dark", type: "button", text: L().phone_reset_btn, onclick: async () => {
      const d = phoneDigits(cc.value, ph.value);
      const show = (t, err) => { msg.hidden = false; msg.textContent = t; msg.classList.toggle("error", !!err); };
      if (d.length < 8) return show(L().phone_bad, true);
      if (pw.value.length < 6) return show(L().pass_short, true);
      go.disabled = true;
      const { data, error } = await sb.rpc("admin_reset_phone_password", { p_email: phoneEmail(d), p_password: pw.value });
      go.disabled = false;
      if (error) return show(L().err + " (" + error.message + ")", true);
      show(data ? L().phone_reset_ok(pw.value) : L().phone_reset_none, !data);
    } });
    return el("div", { class: "box-lite phone-reset" },
      el("h3", { class: "h3", text: L().phone_reset_h }),
      el("p", { class: "note", text: L().phone_reset_p }),
      el("div", { class: "phone-row" }, cc, ph), pw, go, msg);
  }
  /* ---------- Admin: list of ALL members (search, hide, delete) ---------- */
  function membersAdminBox() {
    const list = el("div", { class: "adm-list" });
    const note = el("p", { class: "msg", hidden: "" });
    const inp = el("input", { type: "search", placeholder: L().adm_search_ph, "aria-label": L().adm_search_ph, autocomplete: "off" });
    const when = d => { try { return new Date(d).toLocaleDateString(lang === "ht" ? "fr" : lang, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } };
    const show = (t, err) => { note.hidden = false; note.textContent = t; note.classList.toggle("error", !!err); };
    const row = m => {
      const btns = m.is_admin ? null : el("div", { class: "adm-btns" },
        el("button", { class: "btn small ghost", type: "button", text: m.suspended ? L().restore_member : L().hide_member, onclick: async () => {
          const { error } = await sb.from("profiles").update({ suspended: !m.suspended }).eq("id", m.id);
          if (error) return show(L().err + " (" + error.message + ")", true);
          load(); loadFeatured(); } }),
        el("button", { class: "btn small red", type: "button", text: L().adm_delete, onclick: async () => {
          if (!window.confirm(L().adm_del_confirm(m.display_name))) return;
          const { data, error } = await sb.rpc("admin_delete_member", { p_id: m.id });
          if (error || !data) return show(L().err + (error ? " (" + error.message + ")" : ""), true);
          show(L().adm_deleted(m.display_name)); load(); loadFeatured(); } }));
      return el("div", { class: "adm-row" + (m.suspended ? " is-hidden" : "") },
        el("div", { class: "adm-info" },
          el("div", { class: "adm-name" }, el("a", { href: "#member-" + m.id, text: m.display_name }),
            m.is_admin ? el("span", { class: "tag-admin", text: "Admin" }) : null,
            m.suspended ? el("span", { class: "tag-hidden", text: L().hidden_tag }) : null),
          el("small", { text: [m.hometown, m.contact, when(m.created_at)].filter(Boolean).join(" · ") })),
        btns);
    };
    let timer = null, seq = 0;
    async function load() {
      const my = ++seq;
      const { data, error } = await sb.rpc("admin_list_members", { p_q: inp.value.trim() });
      if (my !== seq) return;
      if (error) { list.replaceChildren(el("p", { class: "empty", text: L().err + " (" + error.message + ")" })); return; }
      list.replaceChildren(...((data || []).length ? data.map(row) : [el("p", { class: "empty", text: L().adm_none })]));
    }
    inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    load();
    return el("div", { class: "box-lite adm-members" },
      el("h3", { class: "h3", text: L().adm_members_h }),
      el("p", { class: "note", text: L().adm_members_p }), inp, note, list);
  }
  async function renderAdmin() {
    const box = $("admin-view");
    if (!sb || !me || !isAdmin) { box.replaceChildren(el("p", { class: "empty", text: L().admin_only })); return; }
    const [{ data: stats }, { data: reports }, { data: hidden }] = await Promise.all([
      sb.rpc("admin_stats"),
      sb.from("member_reports").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(200),
      sb.from("profiles").select(PROFILE_COLS + ",suspended").eq("suspended", true).limit(200)
    ]);
    const ids = [...new Set((reports || []).flatMap(r => [r.reporter, r.reported]))];
    const { data: people } = ids.length ? await sb.from("profiles").select(PROFILE_COLS + ",suspended").in("id", ids) : { data: [] };
    const byId = Object.fromEntries((people || []).map(p => [p.id, p]));
    const st = stats || {};
    const tile = (n, label) => el("div", { class: "stat" }, el("b", { text: String(n ?? 0) }), el("span", { text: label }));
    const nameOf = id => byId[id] ? byId[id].display_name : L().a_member;
    const reportRow = r => {
      const target = byId[r.reported];
      return el("div", { class: "report-row" },
        el("div", { class: "rr-main" },
          el("b", {}, el("a", { href: "#member-" + r.reported, text: nameOf(r.reported) }), target && target.suspended ? el("span", { class: "tag-hidden", text: L().hidden_tag }) : null),
          el("span", { class: "rr-reason", text: L()["rr_" + r.reason] || r.reason }),
          r.details ? el("p", { text: r.details }) : null,
          r.photo_id ? el("a", { class: "rr-photo", href: "#photo/" + r.photo_id, text: "📷 " + L().view_photo }) : null,
          el("span", { class: "meta", text: L().reported_by(nameOf(r.reporter), fmtDate(r.created_at)) })),
        el("div", { class: "row-btns" },
          r.photo_id ? el("button", { class: "btn small red", type: "button", text: L().photo_hide, onclick: async () => {
            await sb.from("photos").update({ hidden: true }).eq("id", r.photo_id);
            await sb.from("member_reports").update({ status: "done" }).eq("id", r.id); renderAdmin(); } }) : null,
          target && !target.suspended ? el("button", { class: "btn small " + (r.photo_id ? "ghost" : "red"), type: "button", text: L().hide_member, onclick: async () => {
            await sb.from("profiles").update({ suspended: true }).eq("id", r.reported);
            await sb.from("member_reports").update({ status: "done" }).eq("reported", r.reported).eq("status", "open");
            renderAdmin(); loadFeatured(); loadTownCounts(); } }) : null,
          el("button", { class: "btn small ghost", type: "button", text: L().close_report, onclick: async () => {
            await sb.from("member_reports").update({ status: "done" }).eq("id", r.id); renderAdmin(); } })));
    };
    const hiddenRow = p => el("div", { class: "member" },
      el("a", { class: "member-link", href: "#member-" + p.id }, avatar(p, "sm"), el("div", {}, el("b", { text: p.display_name }), el("span", { class: "meta", text: p.hometown }))),
      el("button", { class: "btn small ghost", type: "button", text: L().restore_member, onclick: async () => {
        await sb.from("profiles").update({ suspended: false }).eq("id", p.id); renderAdmin(); loadFeatured(); loadTownCounts(); } }));
    box.replaceChildren(
      el("div", { class: "stats" }, tile(st.members, L().st_members), tile(st.new_this_week, L().st_new), tile(st.open_reports, L().st_reports), tile(st.hidden, L().st_hidden), tile(st.messages, L().st_messages), tile(st.photos, L().st_photos), tile(st.alerts, L().st_alerts), tile(st.family_links, L().st_family)),
      membersAdminBox(),
      phoneResetBox(),
      el("h3", { class: "h3", text: L().open_reports }),
      (reports || []).length ? el("div", { class: "reports" }, ...(reports || []).map(reportRow)) : el("p", { class: "empty", text: L().no_reports }),
      el("h3", { class: "h3", text: L().hidden_members }),
      (hidden || []).length ? el("div", { class: "people" }, ...(hidden || []).map(hiddenRow)) : el("p", { class: "empty", text: L().no_hidden }),
      el("p", { class: "note", text: L().admin_note }));
  }

  /* ---------- Hover card: point at a member's picture to see who they are (computers only) ---------- */
  var myLinks = null;   // my friendships, loaded once
  const hoverOK = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  let hcCard = null, hcFor = null, hcShowT = null, hcHideT = null;
  function hideHC() { if (hcCard) hcCard.remove(); hcCard = null; hcFor = null; }
  async function hcFriends(id) {
    if (!myLinks) { const { data } = await sb.from("friendships").select("requester,addressee,status").or(`requester.eq.${me.id},addressee.eq.${me.id}`).limit(2000); myLinks = data || []; }
    const { data } = await sb.from("friendships").select("requester,addressee").eq("status", "accepted").or(`requester.eq.${id},addressee.eq.${id}`).limit(2000);
    const theirs = new Set((data || []).map(f => f.requester === id ? f.addressee : f.requester));
    const mine = new Set(myLinks.filter(f => f.status === "accepted").map(f => f.requester === me.id ? f.addressee : f.requester));
    const mutual = [...theirs].filter(x => mine.has(x));
    const names = [];
    const need = mutual.slice(0, 2).filter(x => !memberCache.has(x));
    if (need.length) { const { data: ps } = await sb.from("profiles").select("id,display_name").in("id", need); (ps || []).forEach(q => memberCache.set(q.id, Object.assign(memberCache.get(q.id) || {}, q))); }
    mutual.slice(0, 2).forEach(x => { const q = memberCache.get(x); if (q && q.display_name) names.push(q.display_name); });
    const link = myLinks.find(f => f.requester === id || f.addressee === id);
    return { count: theirs.size, mutual: mutual.length, names, link };
  }
  async function showHC(t) {
    const id = t.dataset.hc, p = memberCache.get(id);
    if (!p || !me) return;
    hideHC(); hcFor = t;
    const lives = [p.lives_in, p.state, p.country].filter(Boolean).join(", ");
    const sch = schoolsOf(p)[0];
    const self = id === me.id;
    const info = el("div", { class: "hc-info" });
    const btns = el("div", { class: "hc-btns" });
    const card = el("div", { class: "hovercard", role: "dialog", "aria-label": p.display_name },
      el("div", { class: "hc-top" }, avatar(Object.assign({}, p, { id: null }), "hc-av"),
        el("div", { class: "hc-main" },
          el("a", { class: "hc-name", href: "#member-" + id }, p.display_name, foundingStar(p)),
          p.nickname ? el("div", { class: "hc-nick", text: "“" + p.nickname + "”" }) : null,
          info)),
      btns);
    const line = (ic, txt) => txt ? info.append(el("div", { class: "hc-line" }, el("span", { class: "hc-ic", text: ic }), el("span", { text: txt }))) : null;
    line("📍", p.hometown ? `${L().from} ${p.hometown}${p.katye ? " · " + p.katye : ""}` : "");
    line("🏠", lives ? `${L().lives} ${lives}` : "");
    line("🏫", sch ? sch.name + (sch.years ? ` (${sch.years})` : "") : "");
    const fLine = el("div", { class: "hc-line hc-friends" }); info.append(fLine);
    const fBtn = el("span");
    btns.append(...(self ? [el("a", { class: "btn small dark", href: "#member-" + id, text: L().hc_view })] : [
      fBtn,
      el("button", { class: "btn small hc-msg", type: "button", text: L().contact_member, onclick: () => { hideHC(); openThread({ noticeId: null, other: id, title: p.display_name }); } }),
      el("a", { class: "btn small ghost hc-more", href: "#member-" + id, title: L().hc_view, text: "•••" })]));
    document.body.append(card); hcCard = card;
    // place it under (or above) the picture
    const r = t.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - 60), window.innerWidth - w - 8);
    let top = r.bottom + 10; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 10);
    card.style.left = left + "px"; card.style.top = top + "px";
    card.addEventListener("mouseenter", () => clearTimeout(hcHideT));
    card.addEventListener("mouseleave", () => { hcHideT = setTimeout(hideHC, 250); });
    card.addEventListener("click", e => { if (e.target.closest("a[href^='#']")) hideHC(); });
    try {
      const f = await hcFriends(id);
      if (hcCard !== card) return;
      const bits = [L().friend_count(f.count)];
      if (!self && f.mutual) bits.push(L().hc_mutual(f.mutual, f.names));
      fLine.replaceChildren(el("span", { class: "hc-ic", text: "👥" }), el("span", { text: bits.join(" · ") }));
      if (!self) {
        const l = f.link; let b;
        if (!l) b = el("button", { class: "btn small ghost", type: "button", text: L().add_friend, onclick: async () => {
          b.disabled = true; const { error } = await sb.from("friendships").insert({ addressee: id });
          if (!error) { myLinks = null; b.textContent = L().request_sent; } else b.disabled = false; } });
        else if (l.status === "accepted") b = el("span", { class: "chip-item friends-yes", text: "✓ " + L().friends_yes });
        else if (l.requester === me.id) b = el("span", { class: "chip-item", text: L().request_sent });
        else b = el("button", { class: "btn small dark", type: "button", text: L().accept, onclick: async () => {
          b.disabled = true; await sb.from("friendships").update({ status: "accepted" }).eq("requester", id).eq("addressee", me.id);
          myLinks = null; b.replaceWith(el("span", { class: "chip-item friends-yes", text: "✓ " + L().friends_yes })); } });
        fBtn.replaceWith(b);
      }
    } catch (e) { fLine.remove(); }
  }
  if (hoverOK) {
    document.addEventListener("mouseover", e => {
      const t = e.target.closest && e.target.closest("[data-hc]");
      if (!t || !me || t.closest(".hovercard")) return;
      clearTimeout(hcHideT);
      if (hcFor === t) return;
      clearTimeout(hcShowT); hcShowT = setTimeout(() => showHC(t), 400);
    });
    document.addEventListener("mouseout", e => {
      const t = e.target.closest && e.target.closest("[data-hc]");
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      clearTimeout(hcShowT); hcHideT = setTimeout(hideHC, 250);
    });
    window.addEventListener("scroll", hideHC, { passive: true });
    document.addEventListener("keydown", e => { if (e.key === "Escape") hideHC(); });
  }

  /* ---------- WhatsApp invites ---------- */
  const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';
  function wa(text) { window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); }
  // One Share button, like Facebook's: phones open their own share menu (Facebook, WhatsApp, Messenger…);
  // computers get a small menu with the same choices.
  async function shareSheet(text, url) {
    const full = url ? text + " " + url : text;
    // phones/tablets: the phone's own share menu. Computers: our menu (the Windows/Mac share box is confusing)
    const touch = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    if (navigator.share && touch) {
      try { await navigator.share(url ? { title: "Lakaymwen.co", text, url } : { title: "Lakaymwen.co", text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }   // they closed it themselves; anything else: show our menu
    }
    const u = encodeURIComponent(url || siteLink()), t = encodeURIComponent(full);
    $("sh-wa").href = "https://wa.me/?text=" + t;
    $("sh-fb").href = "https://www.facebook.com/sharer/sharer.php?u=" + u;
    $("sh-x").href = "https://x.com/intent/post?text=" + t;
    $("sh-mail").href = "mailto:?subject=" + encodeURIComponent("Lakaymwen.co") + "&body=" + t;
    $("sh-sms").href = "sms:?&body=" + t;
    // "Copy link" copies ONLY the web address (lakaymwen.co…), not the whole message
    const link = url || (String(text).match(/https?:\/\/\S+/) || [])[0] || siteLink();
    $("sh-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(link); } catch (e) { const x = document.createElement("textarea"); x.value = link; document.body.append(x); x.select(); try { document.execCommand("copy"); } catch (e2) {} x.remove(); }
      $("sh-copy-t").textContent = L().copied;
    };
    $("sh-copy-t").textContent = L().copy_link;
    $("sh-copy-u").textContent = link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    openDlg("dlg-share");
  }
  function waBtn(label, textFn, extra) {
    // was a WhatsApp-only button; now one Share button (WhatsApp, Facebook, Messenger, text…)
    return el("button", { class: "btn share-btn" + (extra ? " small" : ""), type: "button", onclick: () => shareSheet(textFn()) },
      el("span", { class: "share-ic", "aria-hidden": "true" }), el("span", { text: label }));
  }

  const schoolHash = n => "#school/" + encodeURIComponent(n);
  const katyeHash = (t, k) => "#katye/" + encodeURIComponent(t) + "/" + encodeURIComponent(k);
  const placeKey = s => norm(s).replace(/[^a-z0-9]+/g, "");
  const startYear = y => { const m = String(y || "").match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; };
  const membersOnly = box => box.replaceChildren(el("div", { class: "empty" }, el("p", { text: L().members_only_page }),
    el("button", { class: "btn dark", type: "button", text: L().login_btn, onclick: () => openAuth(null, "login") })));

  /* ---------- Name alerts ---------- */
  var unseenMatches = 0;
  async function refreshAlerts() {
    if (!sb || !me) { unseenMatches = 0; }
    else {
      const { data } = await sb.from("alert_matches").select("id").eq("seen", false).limit(100);
      unseenMatches = (data || []).length;
    }
    $("alerts-badge").hidden = !unseenMatches; $("alerts-badge").textContent = String(unseenMatches);
    $("side-alerts").hidden = !unseenMatches; $("side-alerts").textContent = L().alerts_badge_side(unseenMatches);
    let unseenTags = 0;
    if (sb && me) { const { data: tg } = await sb.from("photo_tags").select("id").eq("member", me.id).eq("seen", false).limit(100); unseenTags = (tg || []).length; }
    $("photos-badge").hidden = !unseenTags; $("photos-badge").textContent = String(unseenTags);
    $("side-tags").hidden = !unseenTags; $("side-tags").textContent = L().tags_badge_side(unseenTags);
    let famReqs = 0;
    if (sb && me) { const { data: fr } = await sb.from("family_links").select("id").eq("relative", me.id).eq("status", "pending").limit(100); famReqs = (fr || []).length; }
    $("side-fam").hidden = !famReqs; $("side-fam").textContent = L().fam_badge_side(famReqs);
    if (me) $("side-fam").setAttribute("href", "#member-" + me.id);
  }
  async function createAlert(q, town) {
    if (!sb || !me) { openAuth(null, "login"); return [L().search_login, true]; }
    const key = clean(q).replace(/\s+/g, " ").trim();
    if (!/\S{2,}\s+\S{2,}/.test(key)) return [L().alert_need_two, true];
    const { error } = await sb.from("search_alerts").insert({ query: q.trim().replace(/\s+/g, " "), hometown: town || null });
    if (error) {
      const c = error.code || "", m = error.message || "";
      if (c === "23505" || /duplicate/i.test(m)) return [L().alert_dupe, true];
      if (c === "54000" || /too many/i.test(m)) return [L().alert_max, true];
      if (c === "22023" || /first and last/i.test(m)) return [L().alert_need_two, true];
      return [L().err, true];
    }
    if (curHash === "#alerts") renderAlerts();
    return [L().alert_saved(q.trim()), false];
  }
  function alertOffer(q, town, none) {
    const msg = el("p", { class: "msg", hidden: "" });
    const btn = el("button", { class: "btn red", type: "button", text: L().alert_add, onclick: async () => {
      btn.disabled = true;
      const [text, bad] = await createAlert(q, town);
      msg.hidden = false; msg.textContent = text; msg.className = "msg" + (bad ? " error" : " ok");
      btn.disabled = !bad;
    } });
    return el("div", { class: "alert-offer" + (none ? " big" : "") },
      el("p", { class: "ao-text", text: none ? L().alert_offer_none(q) : L().alert_offer(q) }),
      el("div", { class: "row-btns" }, btn, waBtn(L().wa_btn, () => L().inv_search(q, siteLink()), "ghost-wa")),
      msg);
  }
  var alertsReq = 0;
  async function renderAlerts() {
    const box = $("alerts-view"), req = ++alertsReq;
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { membersOnly(box); return; }
    const [{ data: alerts }, { data: matches }] = await Promise.all([
      sb.from("search_alerts").select("*").order("created_at", { ascending: false }),
      sb.from("alert_matches").select("*").order("created_at", { ascending: false }).limit(100)
    ]);
    const ids = [...new Set((matches || []).map(m => m.profile_id))];
    const { data: people } = ids.length ? await sb.from("profiles").select(PROFILE_COLS).in("id", ids) : { data: [] };
    if (req !== alertsReq) return;
    const byId = Object.fromEntries((people || []).map(p => [p.id, p]));
    const alertById = Object.fromEntries((alerts || []).map(a => [a.id, a]));
    const ms = (matches || []).filter(m => byId[m.profile_id] && notBlocked(byId[m.profile_id]));

    const matchCard = m => {
      const a = alertById[m.alert_id] || {};
      return el("div", { class: "match" + (m.seen ? "" : " is-new") },
        el("div", { class: "match-why" }, m.seen ? null : el("span", { class: "new-tag", text: L().new_tag }),
          el("span", { text: "🔔 " + L().alert_matches_q(a.query || "") }),
          m.via === "family" ? el("span", { class: "via", text: " · " + L().alert_via_family(relName(m.family_relation), m.family_name) }) : null,
          el("span", { class: "meta", text: " · " + fmtDate(m.created_at) })),
        memberRow(byId[m.profile_id], clean(a.query || "")));
    };
    const nameIn = el("input", { id: "al-name", type: "text", maxlength: "80", autocomplete: "off", placeholder: "Marie Joseph" });
    const townSel = el("select", { id: "al-town" }, new Option(L().any, ""));
    (window.LAKAYMWEN_TOWNS || []).slice().sort((x, y) => x.localeCompare(y)).forEach(t => townSel.add(new Option(t, t)));
    const formMsg = el("p", { class: "msg", hidden: "" });
    const form = el("form", { class: "alert-form", novalidate: "" },
      el("label", {}, el("span", { text: L().alert_name_lbl }), nameIn),
      el("label", {}, el("span", { text: L().alert_town_lbl }), townSel),
      el("button", { class: "btn red", type: "submit", text: L().alert_add }));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const [text, bad] = await createAlert(nameIn.value, townSel.value);
      formMsg.hidden = false; formMsg.textContent = text; formMsg.className = "msg" + (bad ? " error" : " ok");
      if (!bad) { nameIn.value = ""; townSel.value = ""; }
      else nameIn.focus();
    });
    const alertRow = a => el("li", { class: "watch" },
      el("span", {}, el("b", { text: a.query }), a.hometown ? el("span", { class: "meta", text: L().watching_from(a.hometown) }) : null),
      el("button", { class: "linkbtn", type: "button", text: L().alert_remove, onclick: async () => {
        await sb.from("search_alerts").delete().eq("id", a.id); renderAlerts(); refreshAlerts(); } }));

    box.replaceChildren(
      el("h3", { class: "h3", text: L().alerts_new_h }),
      ms.length ? el("div", { class: "matches" }, ...ms.map(matchCard)) : el("p", { class: "empty", text: L().alerts_none_matches }),
      el("h3", { class: "h3", text: L().alerts_list_h }),
      (alerts || []).length ? el("ul", { class: "watch-list" }, ...(alerts || []).map(alertRow)) : el("p", { class: "note", text: L().alerts_none }),
      form, formMsg,
      el("div", { class: "invite-box" }, el("p", { text: L().alerts_invite }),
        waBtn(L().wa_family, () => L().inv_family(profile?.display_name || "", siteLink()))));
    if (ms.some(m => !m.seen)) {
      await sb.from("alert_matches").update({ seen: true }).eq("seen", false);
      refreshAlerts();
    }
  }

  /* ---------- School directory and pages ---------- */
  var schoolData = null, katyeData = null;
  async function renderSchools() {
    const box = $("schools-view");
    $("school-filter").hidden = !me;
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { membersOnly(box); return; }
    if (!schoolData) {
      box.replaceChildren(el("p", { class: "note", text: "…" }));
      const [{ data }, { data: ks }] = await Promise.all([sb.rpc("school_counts"),
        profile && profile.hometown ? sb.rpc("katye_counts", { p_town: profile.hometown }) : Promise.resolve({ data: [] })]);
      schoolData = data || []; katyeData = ks || [];
    }
    drawSchools();
  }
  function drawSchools() {
    const box = $("schools-view");
    if (!schoolData) return;
    const f = placeKey($("school-filter").value);
    const mine = profile ? schoolsOf(profile) : [];
    const list = schoolData.filter(s => !f || placeKey(s.school).includes(f));
    box.replaceChildren(
      mine.length && !f ? el("div", { class: "my-schools" }, el("h3", { class: "h3", text: L().schools_mine }),
        el("div", { class: "chips" }, ...mine.map(s => el("a", { class: "chip-link", href: schoolHash(s.name), text: "🏫 " + s.name })))) : null,
      list.length ? el("ul", { class: "school-list" }, ...list.map(s => el("li", {},
        el("a", { href: schoolHash(s.school) }, el("span", { text: s.school }), el("span", { class: "count", text: String(s.members) })))))
        : el("p", { class: "empty", text: f ? L().schools_no_match : L().schools_none }),
      !f && katyeData && katyeData.length && profile ? el("div", { class: "other-katye" },
        el("h3", { class: "h3", text: L().katye_mytown(profile.hometown) }),
        el("div", { class: "chips" }, ...katyeData.map(o => el("a", { class: "chip-link", href: katyeHash(profile.hometown, o.katye) },
          "📍 " + o.katye, el("span", { class: "count", text: String(o.members) }))))) : null);
  }
  $("school-filter").addEventListener("input", drawSchools);

  function groupByDecade(people, yearOf) {
    const groups = new Map();
    people.map(p => [p, startYear(yearOf(p))]).sort((a, b) => (a[1] ?? 9999) - (b[1] ?? 9999) || a[0].display_name.localeCompare(b[0].display_name))
      .forEach(([p, y]) => { const k = y ? Math.floor(y / 10) * 10 : 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    return [...groups.entries()];
  }
  var placeReq = 0;
  async function renderSchool(name) {
    const box = $("place-view"), req = ++placeReq;
    $("place-back").setAttribute("href", "#schools"); $("place-back").textContent = L().all_schools;
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { box.replaceChildren(el("h2", { class: "join-h", text: "🏫 " + name })); box.append(el("div")); membersOnly(box.lastChild); return; }
    box.replaceChildren(el("h2", { class: "join-h", text: "🏫 " + name }));
    const { data } = await sb.rpc("school_members", { p_school: name });
    if (req !== placeReq) return;
    const people = (data || []).filter(notBlocked);
    const key = placeKey(name);
    const mySchool = profile ? schoolsOf(profile).find(s => placeKey(s.name) === key) : null;
    const yearOf = p => (schoolsOf(p).find(s => placeKey(s.name) === key) || {}).years;
    const display = (people.map(p => schoolsOf(p).find(s => placeKey(s.name) === key)).find(Boolean) || {}).name || name;
    const addMsg = el("p", { class: "msg ok", hidden: "" });
    const addBtn = !mySchool && profile ? el("button", { class: "btn dark", type: "button", text: L().school_add_me, onclick: async () => {
      addBtn.disabled = true;
      const list = schoolsOf(profile).concat([{ name: display, years: "" }]).slice(0, 15);
      const { data: upd, error } = await sb.from("profiles").update({ school_list: list, schools: list.map(schoolText).join(" · ").slice(0, 300) }).eq("id", me.id).select().single();
      if (error) { addBtn.disabled = false; addMsg.hidden = false; addMsg.className = "msg error"; addMsg.textContent = L().err; return; }
      profile = upd; schoolData = null; addMsg.hidden = false; addMsg.textContent = L().school_added;
      setTimeout(() => renderSchool(name), 900);
    } }) : null;
    box.replaceChildren(
      el("h2", { class: "join-h", text: "🏫 " + display }),
      el("p", { class: "lead", text: L().members_n(people.length) }),
      el("div", { class: "row-btns place-actions" }, waBtn(L().wa_classmates, () => L().inv_school(display, siteLink() + "/" + schoolHash(display))), addBtn),
      addMsg,
      people.length ? el("div", { class: "decades" }, ...groupByDecade(people, yearOf).map(([d, ps]) => el("section", {},
        el("h3", { class: "h3 decade-h", text: d ? L().decade(d) : L().school_years_unknown }),
        el("div", { class: "people" }, ...ps.map(p => memberRow(p))))))
        : el("p", { class: "empty", text: L().place_none }));
  }
  async function renderKatye(town, k) {
    const box = $("place-view"), req = ++placeReq;
    $("place-back").setAttribute("href", "#home"); $("place-back").textContent = L().back_home;
    const title = "📍 " + L().katye_in(k, town);
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { box.replaceChildren(el("h2", { class: "join-h", text: title }), el("div")); membersOnly(box.lastChild); return; }
    box.replaceChildren(el("h2", { class: "join-h", text: title }));
    const [{ data }, { data: others }] = await Promise.all([
      sb.rpc("katye_members", { p_town: town, p_katye: k }), sb.rpc("katye_counts", { p_town: town })]);
    if (req !== placeReq) return;
    const people = (data || []).filter(notBlocked);
    const display = (people[0] && people[0].katye) || k;
    const rest = (others || []).filter(o => placeKey(o.katye) !== placeKey(k));
    box.replaceChildren(
      el("h2", { class: "join-h", text: "📍 " + L().katye_in(display, town) }),
      el("p", { class: "lead", text: L().members_n(people.length) }),
      el("div", { class: "row-btns place-actions" }, waBtn(L().wa_neighbors, () => L().inv_katye(display, town, siteLink() + "/" + katyeHash(town, display)))),
      people.length ? el("div", { class: "people" }, ...people.map(p => memberRow(p))) : el("p", { class: "empty", text: L().place_none }),
      rest.length ? el("div", { class: "other-katye" }, el("h3", { class: "h3", text: L().katye_others(town) }),
        el("div", { class: "chips" }, ...rest.map(o => el("a", { class: "chip-link", href: katyeHash(town, o.katye) }, o.katye, el("span", { class: "count", text: String(o.members) }))))) : null);
  }

  /* ---------- People you may know ---------- */
  const pymkHidden = () => { try { return JSON.parse(store.get("lkm-pymk-hide") || "[]"); } catch (e) { return []; } };
  function reasonText(r) {
    if (r.k === "listed_you") return L().r_listed_you(relName(r.rel));
    if (r.k === "you_listed") return L().r_you_listed(relName(r.rel), r.name);
    if (r.k === "classmate") return L().r_classmate(r.school);
    if (r.k === "school") return L().r_school(r.school);
    if (r.k === "katye") return L().r_katye(r.town);
    if (r.k === "same_name") return L().r_same_name(r.town);
    if (r.k === "mutual") return L().r_mutual(r.n);
    if (r.k === "town") return L().r_town(r.town);
    return "";
  }
  var pymkData = null;
  async function loadPymk() {
    pymkData = null;
    if (sb && me) {
      const { data } = await sb.rpc("suggestions");
      const rows = (data || []).filter(r => !pymkHidden().includes(r.id) && !blockedIds.has(r.id));
      const { data: people } = rows.length ? await sb.from("profiles").select(PROFILE_COLS).in("id", rows.map(r => r.id)) : { data: [] };
      const byId = Object.fromEntries((people || []).map(p => [p.id, p]));
      pymkData = rows.filter(r => byId[r.id]).map(r => ({ p: byId[r.id], reasons: r.reasons || [] }));
    }
    renderPymk();
  }
  function renderPymk() {
    const list = (pymkData || []).filter(x => !pymkHidden().includes(x.p.id));
    $("pymk-box").hidden = !list.length;
    $("pymk").replaceChildren(...list.slice(0, 8).map(({ p, reasons }) => {
      const strong = reasons.filter(r => r.k !== "town");
      const why = (strong.length ? strong : reasons).slice(0, 2).map(reasonText);
      const add = el("button", { class: "btn small dark", type: "button", text: L().add_friend, onclick: async () => {
        add.disabled = true;
        const { error } = await sb.from("friendships").insert({ addressee: p.id });
        add.textContent = error ? L().err : "✓ " + L().request_sent;
      } });
      return el("div", { class: "pymk-card" },
        el("button", { class: "pymk-x", type: "button", "aria-label": L().remove, text: "×", onclick: () => {
          store.set("lkm-pymk-hide", JSON.stringify(pymkHidden().concat(p.id).slice(-200))); renderPymk(); } }),
        el("a", { class: "pymk-link", href: "#member-" + p.id }, avatar(p),
          el("b", {}, p.display_name, foundingStar(p)),
          el("span", { class: "city", text: [p.hometown, p.katye].filter(Boolean).join(" · ") })),
        el("ul", { class: "pymk-why" }, ...why.map(t => el("li", { text: t }))),
        add);
    }));
  }

  /* ---------- Foto lontan: old photos ---------- */
  function resizeBig(file, max = 1600) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error("not an image")); return; }
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error("resize failed")), "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }
  const uuid4 = () => (crypto.randomUUID ? crypto.randomUUID() : "p" + Date.now() + Math.random().toString(16).slice(2));

  // A small "who's in this photo" picker: members by name, or any name typed
  function tagPicker(box, onPick) {
    const inp = el("input", { type: "text", maxlength: "80", autocomplete: "off", placeholder: L().photo_tag_ph });
    const list = el("div", { class: "picker-list", hidden: "" });
    let t = 0;
    const pick = v => { inp.value = ""; list.hidden = true; onPick(v); inp.focus(); };
    inp.addEventListener("input", () => {
      clearTimeout(t);
      const q = inp.value.trim(), key = clean(q);
      if (key.length < 2) { list.hidden = true; return; }
      t = setTimeout(async () => {
        const { data } = await sb.from("profiles").select("id,display_name,nickname,hometown,photo_url").eq("suspended", false)
          .ilike("name_key", `%${key}%`).limit(6);
        const opts = (data || []).filter(notBlocked).map(p => el("button", { type: "button", class: "pick", onclick: () => pick({ member: p.id, name: p.display_name }) },
          avatar(p, "xs"), el("span", {}, el("b", { text: p.display_name }), el("small", { text: " · " + (p.hometown || "") }))));
        opts.push(el("button", { type: "button", class: "pick plain", onclick: () => pick({ member: null, name: q }) }, L().photo_tag_plain(q)));
        list.replaceChildren(...opts); list.hidden = false;
      }, 250);
    });
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); const q = inp.value.trim(); if (q.length >= 2) pick({ member: null, name: q }); }
      if (e.key === "Escape") list.hidden = true;
    });
    box.replaceChildren(inp, list);
    return inp;
  }

  // Upload dialog
  let phFile = null, phTags = [];
  function drawPhTags() {
    $("ph-tags").replaceChildren(...phTags.map((t, i) => el("span", { class: "tag-chip" + (t.member ? " member" : "") }, t.name,
      el("button", { type: "button", "aria-label": L().remove, text: "×", onclick: () => { phTags.splice(i, 1); drawPhTags(); } }))));
  }
  function openPhotoDialog() {
    if (!sb) { alert(L().setup); return; }
    if (!me) { openAuth(null, "login"); return; }
    phFile = null; phTags = []; drawPhTags();
    $("photo-form").reset(); $("ph-preview").hidden = true; $("ph-drop-text").hidden = false; say("photo-msg", "");
    const sel = $("ph-town");
    if (sel.options.length < 2) TOWNS.slice().sort((a, b) => a.localeCompare(b)).forEach(t => sel.add(new Option(t, t)));
    sel.value = profile?.hometown || "";
    tagPicker($("ph-picker"), v => { if (!phTags.some(t => (v.member && t.member === v.member) || (!v.member && norm(t.name) === norm(v.name)))) phTags.push(v); drawPhTags(); });
    openDlg("dlg-photo");
  }
  $("photo-add-btn").addEventListener("click", openPhotoDialog);
  $("ph-file").addEventListener("change", () => {
    phFile = $("ph-file").files[0] || null;
    if (!phFile) return;
    if (!/^image\//.test(phFile.type)) { phFile = null; say("photo-msg", L().photo_bad, true); return; }
    const u = URL.createObjectURL(phFile);
    $("ph-preview").src = u; $("ph-preview").hidden = false; $("ph-drop-text").hidden = true; say("photo-msg", "");
  });
  $("photo-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!phFile) { say("photo-msg", L().photo_need, true); return; }
    const btn = e.submitter || $("photo-form").querySelector("button[type=submit]"); btn.disabled = true;
    say("photo-msg", L().photo_uploading);
    try {
      const blob = await resizeBig(phFile);
      const path = `${me.id}/${uuid4()}.jpg`;
      const { error: upErr } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      const { data: ph, error } = await sb.from("photos").insert({ path, url, caption: $("ph-caption").value.trim() || null,
        town: $("ph-town").value || null, year: $("ph-year").value.trim() || null }).select().single();
      if (error) { sb.storage.from("photos").remove([path]); throw error; }
      for (const t of phTags) await sb.from("photo_tags").insert({ photo_id: ph.id, member: t.member, name: t.name });
      $("dlg-photo").close();
      go("#photo/" + ph.id);
    } catch (err) {
      say("photo-msg", /too many/i.test(err.message || "") ? L().photo_max : L().photo_err, true);
    } finally { btn.disabled = false; }
  });

  // Gallery
  var photosReq = 0;
  async function renderPhotos(tab) {
    const box = $("photos-view"), req = ++photosReq;
    document.querySelectorAll("#photos-page .tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
    const sel = $("photo-town");
    if (sel.options.length < 2) TOWNS.slice().sort((a, b) => a.localeCompare(b)).forEach(t => sel.add(new Option(t, t)));
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { membersOnly(box); return; }
    let q = sb.from("photos").select("*").order("created_at", { ascending: false }).limit(90);
    if (tab === "mine") q = q.eq("owner", me.id);
    if (tab === "me") {
      const { data: tg } = await sb.from("photo_tags").select("photo_id,seen").eq("member", me.id).limit(300);
      const ids = [...new Set((tg || []).map(t => t.photo_id))];
      if (!ids.length) { if (req === photosReq) box.replaceChildren(el("p", { class: "empty", text: L().photos_me_none })); return; }
      q = q.in("id", ids);
      if ((tg || []).some(t => !t.seen)) { await sb.from("photo_tags").update({ seen: true }).eq("member", me.id).eq("seen", false); refreshAlerts(); }
    }
    if (sel.value) q = q.eq("town", sel.value);
    const { data } = await q;
    if (req !== photosReq) return;
    const photos = (data || []).filter(ph => !blockedIds.has(ph.owner));
    const { data: tagRows } = photos.length ? await sb.from("photo_tags").select("photo_id").in("photo_id", photos.map(p => p.id)) : { data: [] };
    const tagN = {}; (tagRows || []).forEach(t => tagN[t.photo_id] = (tagN[t.photo_id] || 0) + 1);
    if (req !== photosReq) return;
    box.replaceChildren(photos.length ? el("div", { class: "photo-grid" }, ...photos.map(ph => el("a", { class: "photo-card", href: "#photo/" + ph.id },
      el("img", { src: ph.url, alt: ph.caption || "", loading: "lazy" }),
      ph.hidden ? el("span", { class: "tag-hidden", text: L().hidden_tag }) : null,
      el("span", { class: "pc-text" }, el("b", { text: ph.caption || L().photo_no_caption }),
        el("small", { text: [ph.year, ph.town, tagN[ph.id] ? L().photo_tagged_n(tagN[ph.id]) : null].filter(Boolean).join(" · ") })))))
      : el("div", { class: "empty" }, el("p", { text: tab === "mine" ? L().photos_mine_none : L().photos_none }),
          el("button", { class: "btn red", type: "button", text: L().photo_add, onclick: openPhotoDialog })));
  }
  $("photo-town").addEventListener("change", () => { if (pageFor(curHash)) route(); });

  // One photo
  var photoReq = 0;
  async function renderPhoto(id) {
    const box = $("photo-view"), req = ++photoReq;
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { membersOnly(box); return; }
    const [{ data: ph }, { data: tags }, { data: comments }] = await Promise.all([
      sb.from("photos").select("*").eq("id", id).maybeSingle(),
      sb.from("photo_tags").select("*").eq("photo_id", id).order("created_at"),
      sb.from("photo_comments").select("*").eq("photo_id", id).order("created_at").limit(300)]);
    if (req !== photoReq) return;
    if (!ph) { box.replaceChildren(el("p", { class: "empty", text: L().photo_gone })); return; }
    const pids = [...new Set([ph.owner, ...(comments || []).map(c => c.author)])];
    const { data: people } = await sb.from("profiles").select("id,display_name,photo_url,hometown").in("id", pids);
    if (req !== photoReq) return;
    const byId = Object.fromEntries((people || []).map(p => [p.id, p]));
    const owner = byId[ph.owner] || { id: ph.owner, display_name: L().a_member };
    const mine = ph.owner === me.id;
    const myTag = (tags || []).find(t => t.member === me.id && !t.seen);
    if (myTag) { sb.from("photo_tags").update({ seen: true }).eq("id", myTag.id).then(() => refreshAlerts()); }
    const canRemoveTag = t => mine || isAdmin || t.added_by === me.id || t.member === me.id;
    const tagChips = el("div", { class: "tag-chips big" }, ...(tags || []).filter(t => !t.member || notBlocked({ id: t.member })).map(t => el("span", { class: "tag-chip" + (t.member ? " member" : "") },
      t.member ? el("a", { href: "#member-" + t.member, text: t.name }) : t.name,
      canRemoveTag(t) ? el("button", { type: "button", "aria-label": L().remove, text: "×", onclick: async () => {
        await sb.from("photo_tags").delete().eq("id", t.id); renderPhoto(id); } }) : null)));
    const pickerBox = el("div", { class: "tag-picker" });
    const tagMsg = el("p", { class: "msg error", hidden: "" });
    const commentList = el("div", { class: "comments" }, ...(comments || []).filter(c => notBlocked({ id: c.author })).map(c => {
      const a = byId[c.author] || { id: c.author, display_name: L().a_member };
      return el("div", { class: "comment" }, avatar(a, "sm"),
        el("div", {}, el("a", { href: "#member-" + a.id, text: a.display_name }), el("span", { class: "meta", text: " · " + fmtDate(c.created_at) }),
          el("p", { text: c.body })),
        (c.author === me.id || mine || isAdmin) ? el("button", { class: "linkbtn", type: "button", text: "×", "aria-label": L().remove, onclick: async () => {
          await sb.from("photo_comments").delete().eq("id", c.id); renderPhoto(id); } }) : null);
    }));
    const cBody = el("textarea", { maxlength: "1000", placeholder: L().comment_ph, rows: "2" });
    const cMsg = el("p", { class: "msg error", hidden: "" });
    const cForm = el("form", { class: "comment-form", novalidate: "" }, cBody, el("button", { class: "btn dark", type: "submit", text: L().comment_btn }), cMsg);
    cForm.addEventListener("submit", async e => {
      e.preventDefault();
      const body = cBody.value.trim(); if (!body) { cBody.focus(); return; }
      const { error } = await sb.from("photo_comments").insert({ photo_id: id, body });
      if (error) { cMsg.hidden = false; cMsg.textContent = L().err; return; }
      renderPhoto(id);
    });
    const actions = el("div", { class: "row-btns photo-actions" },
      waBtn(L().wa_photo, () => L().inv_photo(ph.caption || "", siteLink() + "/" + "#photo/" + ph.id), "ghost-wa"),
      mine ? el("button", { class: "btn ghost", type: "button", text: L().photo_delete, onclick: async () => {
        if (!confirm(L().photo_delete_q)) return;
        await sb.from("photos").delete().eq("id", ph.id); sb.storage.from("photos").remove([ph.path]); go("#photos/mine"); } }) : null,
      !mine ? el("button", { class: "linkbtn", type: "button", text: L().report_photo_btn, onclick: () => openReport(owner, ph) }) : null,
      isAdmin ? el("button", { class: "btn small " + (ph.hidden ? "ghost" : "red"), type: "button", text: ph.hidden ? L().photo_restore : L().photo_hide, onclick: async () => {
        await sb.from("photos").update({ hidden: !ph.hidden }).eq("id", ph.id); renderPhoto(id); } }) : null);
    box.replaceChildren(
      el("figure", { class: "photo-big" }, el("img", { src: ph.url, alt: ph.caption || "" }),
        ph.hidden ? el("span", { class: "tag-hidden", text: L().hidden_tag }) : null),
      el("h2", { class: "photo-caption", text: ph.caption || L().photo_no_caption }),
      el("p", { class: "meta photo-meta" }, [ph.year, ph.town].filter(Boolean).join(" · "), (ph.year || ph.town) ? " · " : "",
        L().photo_added_by + " ", el("a", { href: "#member-" + owner.id, text: owner.display_name }), " · " + fmtDate(ph.created_at)),
      actions,
      el("h3", { class: "h3", text: L().photo_who_h }),
      (tags || []).length ? tagChips : el("p", { class: "note", text: L().photo_no_tags }),
      pickerBox, tagMsg,
      el("h3", { class: "h3", text: L().comments_h((comments || []).length) }),
      commentList, cForm);
    tagPicker(pickerBox, async v => {
      const { error } = await sb.from("photo_tags").insert({ photo_id: id, member: v.member, name: v.name });
      if (error) { tagMsg.hidden = false; tagMsg.textContent = /duplicate|unique/i.test(error.message || "") ? L().tag_dupe : L().tag_err; return; }
      renderPhoto(id);
    });
  }
  // Photos on a member's profile
  async function memberPhotos(pid) {
    if (!sb || !me) return null;
    const { data: tg } = await sb.from("photo_tags").select("photo_id").eq("member", pid).limit(60);
    const ids = [...new Set((tg || []).map(t => t.photo_id))];
    if (!ids.length) return null;
    const { data: phs } = await sb.from("photos").select("id,url,caption,year,town").in("id", ids).order("created_at", { ascending: false }).limit(12);
    if (!(phs || []).length) return null;
    return phs;
  }

  /* ---------- Family tree: confirmed links between relatives ---------- */
  const LINK_RELS = ["mother","father","brother","sister","son","daughter","spouse","grandparent","grandchild","aunt","uncle","niece","nephew","cousin","other"];
  const GUESS_BACK = { spouse: "spouse", cousin: "cousin", grandparent: "grandchild", grandchild: "grandparent", other: "other" };
  const relSelect = (value, blank) => {
    const s = el("select", { "aria-label": L().relation });
    if (blank) s.add(new Option(L().choose_rel, ""));
    LINK_RELS.forEach(r => s.add(new Option(relName(r), r)));
    s.value = value || "";
    return s;
  };
  // what "other" is to "pid", from one accepted link
  const relTo = (lk, pid) => lk.requester === pid ? lk.relation : lk.relation_back;
  const otherOf = (lk, pid) => lk.requester === pid ? lk.relative : lk.requester;
  async function familyLinksOf(pid) {
    const { data } = await sb.from("family_links").select("*").or(`requester.eq.${pid},relative.eq.${pid}`).limit(300);
    return data || [];
  }
  function acceptBox(lk, from, onDone) {
    const sel = relSelect(GUESS_BACK[lk.relation] || "", true);
    const msg = el("p", { class: "msg error", hidden: "" });
    return el("div", { class: "fam-request" },
      el("p", {}, el("a", { href: "#member-" + from.id, text: from.display_name }), " " + L().fam_says_you(relName(lk.relation))),
      el("label", { class: "inline" }, el("span", { text: L().fam_what_is(from.first_name || from.display_name) }), sel),
      el("div", { class: "row-btns" },
        el("button", { class: "btn small dark", type: "button", text: L().fam_confirm, onclick: async () => {
          if (!sel.value) { msg.hidden = false; msg.textContent = L().fam_pick; sel.focus(); return; }
          const { error } = await sb.from("family_links").update({ status: "accepted", relation_back: sel.value }).eq("id", lk.id);
          if (error) { msg.hidden = false; msg.textContent = L().err; return; }
          onDone(); refreshAlerts();
        } }),
        el("button", { class: "btn small ghost", type: "button", text: L().fam_not_family, onclick: async () => {
          await sb.from("family_links").delete().eq("id", lk.id); onDone(); refreshAlerts(); } })),
      msg);
  }
  async function familySection(p, sec, req) {
    const self = p.id === me.id;
    const links = await familyLinksOf(p.id);
    if (req !== memberReq) return;
    const accepted = links.filter(l => l.status === "accepted");
    const incoming = self ? links.filter(l => l.status === "pending" && l.relative === me.id) : [];
    const between = links.find(l => (l.requester === me.id && l.relative === p.id) || (l.requester === p.id && l.relative === me.id));
    const ids = [...new Set([...accepted.map(l => otherOf(l, p.id)), ...incoming.map(l => l.requester)])];
    const { data: ppl } = ids.length ? await sb.from("profiles").select(PROFILE_COLS).in("id", ids) : { data: [] };
    if (req !== memberReq) return;
    const byId = Object.fromEntries((ppl || []).map(x => [x.id, x]));
    const rerender = () => renderMemberPage(p.id);
    const parts = [];

    // requests waiting for me
    incoming.filter(l => byId[l.requester] && notBlocked(byId[l.requester])).forEach(l => parts.push(acceptBox(l, byId[l.requester], rerender)));
    // a request from this person to me, shown on their page too
    if (!self && between && between.status === "pending" && between.relative === me.id) parts.push(acceptBox(between, p, rerender));

    // confirmed relatives
    const rels = accepted.map(l => ({ who: byId[otherOf(l, p.id)], rel: relTo(l, p.id), lk: l })).filter(x => x.who && notBlocked(x.who));
    if (rels.length) parts.push(el("div", { class: "fam-links" }, ...rels.map(({ who, rel }) =>
      el("a", { class: "fam-card", href: "#member-" + who.id }, avatar(who, "sm"),
        el("span", {}, el("small", { text: relName(rel) }), el("b", { text: who.display_name }))))));

    // "Is this your brother Paul Member?" for names typed in my family list
    if (self && (p.family || []).length) {
      const linkedKeys = rels.map(x => x.who.name_key || norm(x.who.display_name));
      const pendingOut = links.filter(l => l.status === "pending" && l.requester === me.id).map(l => l.relative);
      const todo = (p.family || []).filter(f => (f.name || "").trim().split(/\s+/).length >= 2 &&
        !linkedKeys.some(k => norm(f.name).split(/\s+/).every(w => k.includes(w)))).slice(0, 10);
      for (const f of todo) {
        const words = norm(f.name).split(/\s+/).filter(Boolean);
        const { data: cands } = await sb.from("profiles").select("id,display_name,name_key,hometown,photo_url").eq("suspended", false)
          .ilike("name_key", `%${clean(words[words.length - 1])}%`).limit(20);
        if (req !== memberReq) return;
        const c = (cands || []).filter(x => x.id !== me.id && notBlocked(x) && words.every(w => (x.name_key || "").includes(w)))[0];
        if (!c) continue;
        const waiting = pendingOut.includes(c.id);
        const rel = LINK_RELS.includes(f.relation) ? f.relation : "other";
        parts.push(el("div", { class: "fam-suggest" }, avatar(c, "sm"),
          el("p", {}, L().fam_is_this(relName(rel)), " ", el("a", { href: "#member-" + c.id, text: c.display_name }), c.hometown ? ` (${c.hometown})?` : "?"),
          waiting ? el("span", { class: "chip-item", text: L().fam_waiting })
            : el("button", { class: "btn small dark", type: "button", text: L().fam_link_us, onclick: async ev => {
              ev.target.disabled = true;
              const { error } = await sb.from("family_links").insert({ relative: c.id, relation: rel });
              ev.target.textContent = error ? L().err : "✓ " + L().fam_sent;
            } })));
      }
    }
    // "We're family" on someone else's page
    if (!self && !between && notBlocked(p)) {
      const sel = relSelect("", true);
      const msg = el("p", { class: "msg", hidden: "" });
      const form = el("div", { class: "fam-add", hidden: "" },
        el("label", { class: "inline" }, el("span", { text: L().fam_is_my(p.first_name || p.display_name) }), sel),
        el("button", { class: "btn small dark", type: "button", text: L().fam_send, onclick: async () => {
          if (!sel.value) { msg.hidden = false; msg.className = "msg error"; msg.textContent = L().fam_pick; return; }
          const { error } = await sb.from("family_links").insert({ relative: p.id, relation: sel.value });
          msg.hidden = false; msg.className = "msg" + (error ? " error" : " ok"); msg.textContent = error ? L().err : L().fam_sent_long(p.first_name || p.display_name);
          if (!error) form.querySelector("button").disabled = true;
        } }), msg);
      parts.push(el("button", { class: "btn small ghost", type: "button", text: "👪 " + L().fam_we_are, onclick: ev => { ev.target.hidden = true; form.hidden = false; } }), form);
    }
    if (!self && between && between.status === "pending" && between.requester === me.id)
      parts.push(el("p", { class: "note" }, L().fam_waiting_for(p.first_name || p.display_name), " ",
        el("button", { class: "linkbtn", type: "button", text: L().cancel, onclick: async () => { await sb.from("family_links").delete().eq("id", between.id); rerender(); } })));
    if (!self && between && between.status === "accepted")
      parts.push(el("p", { class: "note" }, "✓ " + L().fam_linked_you(relName(relTo(between, me.id))), " ",
        el("button", { class: "linkbtn", type: "button", text: L().fam_unlink, onclick: async () => {
          if (!confirm(L().fam_unlink_q)) return; await sb.from("family_links").delete().eq("id", between.id); rerender(); } })));

    sec.hidden = false;
    sec.replaceChildren(
      el("div", { class: "fam-head" }, el("h2", { text: L().fam_on_site })),
      ...(parts.length ? parts : [el("p", { class: "note", text: self ? L().fam_none_self : L().fam_none })]));
  }

  // The tree page: one person in the middle, relatives around, click to walk the tree
  var treeReq = 0;
  async function renderTree(id) {
    const box = $("tree-view"), req = ++treeReq;
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) { membersOnly(box); return; }
    const [{ data: p }, links] = await Promise.all([sb.from("profiles").select(PROFILE_COLS).eq("id", id).maybeSingle(), familyLinksOf(id)]);
    if (req !== treeReq) return;
    if (!p) { box.replaceChildren(el("p", { class: "empty", text: L().profile_missing })); return; }
    const acc = links.filter(l => l.status === "accepted");
    const ids = [...new Set(acc.map(l => otherOf(l, id)))];
    const { data: ppl } = ids.length ? await sb.from("profiles").select(PROFILE_COLS).in("id", ids) : { data: [] };
    if (req !== treeReq) return;
    const byId = Object.fromEntries((ppl || []).map(x => [x.id, x]));
    const members = acc.map(l => ({ who: byId[otherOf(l, id)], rel: relTo(l, id) })).filter(x => x.who && notBlocked(x.who));
    // names typed in the family list that aren't linked yet
    const linkedKeys = members.map(x => x.who.name_key || norm(x.who.display_name));
    const typed = (p.family || []).filter(f => (f.name || "").trim().length >= 2 && !linkedKeys.some(k => norm(f.name).split(/\s+/).every(w => k.includes(w))))
      .map(f => ({ name: f.name, rel: LINK_RELS.includes(f.relation) ? f.relation : "other" }));
    const all = members.concat(typed);
    const pick = list => all.filter(x => list.includes(x.rel));
    const card = x => x.who
      ? el("a", { class: "tree-card", href: "#tree/" + x.who.id, title: L().tree_walk(x.who.first_name || x.who.display_name) },
          avatar(x.who, "sm"), el("span", {}, el("small", { text: relName(x.rel) }), el("b", { text: x.who.display_name })))
      : el("div", { class: "tree-card ghost", title: L().tree_not_member },
          el("div", { class: "avatar sm", "aria-hidden": "true", text: initialsOf(x.name) }), el("span", {}, el("small", { text: relName(x.rel) }), el("b", { text: x.name }), el("em", { text: L().tree_not_member })));
    const row = (label, list, cls) => list.length ? el("div", { class: "tree-row " + (cls || "") }, el("div", { class: "tree-label", text: label }), el("div", { class: "tree-cards" }, ...list.map(card))) : null;
    const center = el("div", { class: "tree-row center" }, el("div", { class: "tree-label", text: "" }), el("div", { class: "tree-cards" },
      ...pick(["brother", "sister"]).map(card),
      el("a", { class: "tree-card me", href: "#member-" + p.id }, avatar(p, "sm"), el("span", {}, el("small", { text: p.id === me.id ? L().tree_you : L().tree_person }), el("b", { text: p.display_name }))),
      ...pick(["spouse"]).map(card)));
    const linkedN = members.length;
    box.replaceChildren(
      el("h2", { class: "join-h", text: "🌳 " + L().tree_h(p.display_name) }),
      el("p", { class: "lead", text: L().tree_p }),
      el("div", { class: "tree" },
        row(L().tree_grand, pick(["grandparent"])),
        row(L().tree_parents, pick(["mother", "father"])),
        center,
        row(L().tree_children, pick(["son", "daughter"])),
        row(L().tree_grandchildren, pick(["grandchild"])),
        row(L().tree_extended, pick(["aunt", "uncle", "niece", "nephew", "cousin", "other"]), "extended")),
      !all.length ? el("p", { class: "empty", text: p.id === me.id ? L().tree_empty_self : L().tree_empty }) : null,
      el("div", { class: "row-btns place-actions" },
        el("a", { class: "btn ghost", href: "#member-" + p.id, text: L().tree_profile }),
        p.id === me.id ? waBtn(L().wa_family, () => L().inv_tree(p.display_name, siteLink())) : null),
      linkedN ? el("p", { class: "note", text: L().tree_count(linkedN) }) : null);
  }

  /* ---------- Simple pages: one box shown in the middle column ---------- */
  function pageFor(h) {
    let m;
    const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    if (h === "#alerts") return { box: "alerts-page", render: renderAlerts };
    if (h === "#schools") return { box: "schools-page", render: renderSchools };
    // family tree removed: old tree links open the member's profile instead
    if ((m = h.match(/^#tree\/([0-9a-f-]{36})$/i))) { setTimeout(() => go("#member-" + m[1]), 0); return null; }
    if (h === "#photos" || h === "#photos/me" || h === "#photos/mine") return { box: "photos-page", render: () => renderPhotos(h.split("/")[1] || "all") };
    if ((m = h.match(/^#photo\/([0-9a-z-]{8,40})$/i))) return { box: "photo-page", render: () => renderPhoto(m[1]) };
    if ((m = h.match(/^#school\/(.+)$/))) return { box: "place-page", render: () => renderSchool(dec(m[1])) };
    if ((m = h.match(/^#katye\/([^/]+)\/(.+)$/))) return { box: "place-page", render: () => renderKatye(dec(m[1]), dec(m[2])) };
    return null;
  }

  /* ---------- Dialog closing ---------- */
  document.querySelectorAll("dialog").forEach(d => {
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
    d.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => d.close()));
  });

  /* ---------- Shared notice links (#notice-…) ---------- */
  async function openSharedNotice() {
    const m = location.hash.match(/^#notice-([0-9a-f-]{36})$/i);
    if (!m || !sb) return;
    const { data } = await sb.from("notices").select("*").eq("id", m[1]).maybeSingle();
    if (!data) return;
    lastResults = { q: data.person_name, title: data.person_name, notices: [data], members: null };
    renderResults();
    $("results").scrollIntoView({ block: "start" });
  }
  /* ---------- In-page navigation: home, register page (#register), profiles (#member-…) ---------- */
  // Links are handled in the page itself, so they work on the real site and in previews.
  let currentMember = null;
  let curHash = location.hash || "#home";
  function go(h) {
    navClosing = true;
    document.querySelectorAll("dialog[open]").forEach(d => { if (!(recoveryMode && d.id === "dlg-forgot")) d.close(); });
    setTimeout(() => { navClosing = false; }, 50);   // "close" events arrive a moment later
    if (h !== curHash) {
      curHash = h;
      try { history.pushState(null, "", h); } catch (e) {}
    }
    route(true);
  }
  // Computers: put "👤 Logged in as …" on the same line as "← Back to home", on the right
  const whoHome = $("who-bar").parentNode, whoNext = $("who-bar").nextSibling;
  function placeWho() {
    const bar = $("who-bar"); if (!bar) return;
    if (window.matchMedia("(max-width:760px)").matches || bar.hidden) { if (bar.parentNode !== whoHome) whoHome.insertBefore(bar, whoNext); bar.classList.remove("inline"); return; }
    const main = document.querySelector("#home .portal-main");
    const box = main && [...main.children].find(c => c !== bar && c.offsetParent !== null && c.getBoundingClientRect().height > 0);
    if (!box) { if (bar.parentNode !== whoHome) whoHome.insertBefore(bar, whoNext); bar.classList.remove("inline"); return; }
    if (bar.parentNode !== box || box.firstElementChild !== bar) box.insertBefore(bar, box.firstChild);
    bar.classList.add("inline");
  }
  window.addEventListener("resize", () => requestAnimationFrame(placeWho));
  function route(scroll) {
    setTimeout(placeWho, 0); setTimeout(placeWho, 400);
    const h = curHash;
    let join = h === "#join";
    if (join && !$("r-town").value) { curHash = "#register"; try { history.replaceState(null, "", curHash); } catch (e) {} join = false; }
    if (join) {
      setJoinTown(); say("join-msg", "");
      $("join-loggedin").hidden = !me;
      if (me) $("join-loggedin-text").textContent = L().join_loggedin(profile?.display_name || profile?.username || "");
      setTimeout(() => $("r-user").focus(), 60);
    }
    document.body.classList.toggle("join-mode", join);
    const privacy = curHash === "#privacy", admin = curHash === "#admin";
    document.body.classList.toggle("privacy-mode", privacy);
    document.body.classList.toggle("admin-mode", admin);
    if (privacy) { renderPrivacy(); window.scrollTo(0, 0); }
    if (admin) { renderAdmin(); window.scrollTo(0, 0); }
    document.body.classList.toggle("about-mode", curHash === "#about");
    const search = curHash === "#search";
    document.body.classList.toggle("search-mode", search);
    if (search) { window.scrollTo(0, 0); setTimeout(() => $("s-name").focus(), 60); showMyTown(); }
    if (me && (!h || h === "#home")) showMyTown();
    const pg = pageFor(curHash);
    document.body.classList.toggle("page-mode", !!pg);
    document.querySelectorAll(".page-box.page-on").forEach(b => b.classList.remove("page-on"));
    if (pg) { $(pg.box).classList.add("page-on"); window.scrollTo(0, 0); pg.render(); }
    const reg = curHash === "#register" || curHash === "#towns" || join;
    const m = curHash.match(/^#member-([0-9a-f-]{36})$/i);
    const wasMode = document.body.classList.contains("register-mode") || document.body.classList.contains("member-mode");
    document.body.classList.toggle("register-mode", reg);
    document.body.classList.toggle("member-mode", !!m);
    if (m) { if (currentMember !== m[1]) window.scrollTo(0, 0); currentMember = m[1]; renderMemberPage(currentMember); }
    else currentMember = null;
    if (reg || m) { if (scroll || !wasMode) window.scrollTo(0, 0); return; }
    if (pg) return;
    if (!scroll) return;
    const target = h === "#home" ? null : document.getElementById(h.slice(1));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" }); else window.scrollTo(0, 0);
  }
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const h = a.getAttribute("href");
    if (h.length < 2) return;
    e.preventDefault();
    go(h);
  });
  window.addEventListener("popstate", () => { curHash = location.hash || "#home"; route(true); });

  /* ---------- Member profile page (#member-…) ---------- */
  let memberReq = 0;
  async function renderMemberPage(id) {
    const box = $("member-view"), req = ++memberReq;
    if (!sb) { box.replaceChildren(el("p", { class: "msg error", text: L().setup })); return; }
    if (!me) {
      box.replaceChildren(el("div", { class: "empty" }, el("p", { text: L().profile_login }),
        el("button", { class: "btn dark", type: "button", text: L().login_btn, onclick: () => openAuth(null, "login") })));
      return;
    }
    const [{ data: p }, { data: links }] = await Promise.all([
      sb.from("profiles").select(PROFILE_COLS).eq("id", id).maybeSingle(),
      sb.from("friendships").select("*").or(`requester.eq.${id},addressee.eq.${id}`)
    ]);
    if (req !== memberReq) return;
    if (!p) { box.replaceChildren(el("p", { class: "empty", text: L().profile_missing })); return; }
    const self = p.id === me.id;
    const all = links || [];
    const friendIds = all.filter(f => f.status === "accepted").map(f => f.requester === id ? f.addressee : f.requester);
    const requestIds = self ? all.filter(f => f.status === "pending" && f.addressee === me.id).map(f => f.requester) : [];
    const need = [...new Set([...friendIds, ...requestIds])];
    const { data: people } = need.length ? await sb.from("profiles").select(PROFILE_COLS).in("id", need) : { data: [] };
    if (req !== memberReq) return;
    const byId = Object.fromEntries((people || []).map(x => [x.id, x]));
    const link = all.find(f => (f.requester === me.id && f.addressee === id) || (f.requester === id && f.addressee === me.id));


    const family = (p.family || []).length
      ? el("ul", { class: "family-view" }, ...(p.family || []).map(f => el("li", {}, el("span", { class: "rel", text: relName(f.relation) }), el("b", { text: f.name }))))
      : el("p", { class: "note", text: self ? L().family_none_self : L().family_none });

    const friendCard = f => el("a", { class: "member-card", href: "#member-" + f.id },
      avatar(f), el("b", { text: f.display_name }), el("span", { class: "city", text: f.hometown }));
    const friends = friendIds.map(x => byId[x]).filter(Boolean);
    const friendsBox = friends.length ? el("div", { class: "featured" }, ...friends.map(friendCard))
      : el("p", { class: "note", text: self ? L().friends_none_self : L().friends_none });

    let actions;
    const isBlocked = blockedIds.has(p.id);
    const safety = self ? null : el("div", { class: "safety-links" },
      isBlocked ? el("button", { class: "linkbtn", type: "button", text: L().unblock, onclick: () => unblockMember(p.id) })
                : el("button", { class: "linkbtn", type: "button", text: L().block, onclick: () => blockMember(p.id) }),
      el("span", { text: "·" }),
      el("button", { class: "linkbtn", type: "button", text: L().report_btn, onclick: () => openReport(p) }));
    if (self) actions = [el("button", { class: "btn dark", type: "button", text: L().edit_profile, onclick: () => openProfile(false) }),
      waBtn(L().wa_family, () => L().inv_family(p.display_name, siteLink())),
      el("button", { class: "linkbtn danger-link", type: "button", text: L().delete_account, onclick: async () => {
        await openProfile(false);
        $("del-confirm").hidden = false; $("del-word").value = "";
        setTimeout(() => { $("del-confirm").scrollIntoView({ behavior: "smooth", block: "center" }); $("del-word").focus(); }, 80); } })];
    else if (isBlocked) actions = [el("span", { class: "chip-item", text: L().you_blocked })];
    else {
      const msgBtn = el("button", { class: "btn red", type: "button", text: L().contact_member,
        onclick: () => openThread({ noticeId: null, other: p.id, title: p.display_name }) });
      let fBtn;
      if (!link) fBtn = el("button", { class: "btn ghost", type: "button", text: L().add_friend, onclick: async ev => {
        ev.target.disabled = true;
        const { error } = await sb.from("friendships").insert({ addressee: p.id });
        if (error) { ev.target.disabled = false; return; }
        renderMemberPage(id);
      } });
      else if (link.status === "accepted") fBtn = el("span", { class: "chip-item friends-yes", text: "✓ " + L().friends_yes });
      else if (link.requester === me.id) fBtn = el("button", { class: "btn ghost", type: "button", text: L().request_sent, title: L().cancel_request, onclick: async () => {
        await sb.from("friendships").delete().eq("requester", me.id).eq("addressee", p.id); renderMemberPage(id);
      } });
      else fBtn = el("button", { class: "btn dark", type: "button", text: L().accept_request, onclick: async () => {
        await sb.from("friendships").update({ status: "accepted" }).eq("requester", p.id).eq("addressee", me.id); renderMemberPage(id);
      } });
      actions = [msgBtn, fBtn];
    }

    const requests = requestIds.map(x => byId[x]).filter(Boolean);
    const requestsBox = self && requests.length ? el("section", { class: "requests" },
      el("h2", { text: L().friend_requests(requests.length) }),
      el("div", { class: "people" }, ...requests.map(r => el("div", { class: "member" },
        el("a", { class: "member-link", href: "#member-" + r.id }, avatar(r, "sm"),
          el("div", {}, el("b", { text: r.display_name }), el("span", { class: "meta", text: `${L().from} ${r.hometown}` }))),
        el("div", { class: "row-btns" },
          el("button", { class: "btn small dark", type: "button", text: L().accept, onclick: async () => {
            await sb.from("friendships").update({ status: "accepted" }).eq("requester", r.id).eq("addressee", me.id); renderMemberPage(id); } }),
          el("button", { class: "btn small ghost", type: "button", text: L().decline, onclick: async () => {
            await sb.from("friendships").delete().eq("requester", r.id).eq("addressee", me.id); renderMemberPage(id); } })))))) : null;

    box.replaceChildren(el("article", { class: "profile-card" },
      el("div", { class: "profile-cover" }),
      el("div", { class: "profile-top" },
        avatar(p, "xl"),
        el("div", { class: "profile-id" },
          el("h1", { text: p.display_name }),
          el("p", { class: "handle", text: [p.username ? "@" + p.username : "", p.nickname ? "“" + p.nickname + "”" : ""].filter(Boolean).join(" · ") })),
        el("div", { class: "profile-actions" }, ...actions, safety)),
      el("div", { class: "profile-main" },
        el("aside", { class: "profile-intro" },
          el("h2", { text: L().intro_h }),
          p.bio ? el("p", { class: "intro-bio", text: p.bio }) : null,
          el("ul", { class: "intro-list" },
            p.founding ? el("li", { class: "founding" }, el("span", { class: "ii", text: "★" }), el("span", {}, L().founding_badge + (p.old_username ? " · " + p.old_username : ""))) : null,
            el("li", {}, el("span", { class: "ii", text: "🏠" }), el("span", {}, L().from + " ", el("b", { text: p.hometown }))),
            p.katye ? el("li", {}, el("span", { class: "ii", text: "📍" }), el("span", {}, L().katye_short + " ", el("a", { href: katyeHash(p.hometown, p.katye) }, el("b", { text: p.katye })))) : null,
            ...schoolsOf(p).map(o => el("li", {}, el("span", { class: "ii", text: "🏫" }), el("span", {}, L().studied_at + " ", el("a", { href: schoolHash(o.name) }, el("b", { text: o.name })), o.years ? el("small", { text: " · " + o.years }) : null))),
            p.lives_in || p.country ? el("li", {}, el("span", { class: "ii", text: "🌎" }), el("span", {}, L().lives + " ", el("b", { text: [p.lives_in, p.state, p.country].filter(Boolean).join(", ") }))) : null,
            el("li", {}, el("span", { class: "ii", text: "👥" }), el("span", {}, el("b", { text: L().friend_count(friends.length) }))))),
        el("div", { class: "profile-body" },
          requestsBox,
          el("section", {}, el("h2", { text: me && p.id === me.id ? L().sec_family : L().fam_h }), family),
          el("section", { class: "profile-family-links", hidden: "" }),
          el("section", {}, el("h2", { text: L().friend_list(p.first_name || p.display_name) }), friendsBox),
          el("section", { class: "profile-photos", hidden: "" }))))
    );
    const famSec = box.querySelector(".profile-family-links");
    if (famSec) familySection(p, famSec, req).catch(() => {});
    const phs = await memberPhotos(p.id);
    const sec = box.querySelector(".profile-photos");
    if (req !== memberReq || !sec || !phs) return;
    sec.hidden = false;
    sec.replaceChildren(el("h2", { text: L().photos_with(p.first_name || p.display_name) }),
      el("div", { class: "photo-grid small" }, ...phs.map(ph => el("a", { class: "photo-card", href: "#photo/" + ph.id },
        el("img", { src: ph.url, alt: ph.caption || "", loading: "lazy" }),
        el("span", { class: "pc-text" }, el("small", { text: [ph.year, ph.town].filter(Boolean).join(" · ") || (ph.caption || "") }))))));
  }
  window.addEventListener("hashchange", () => { if ((location.hash || "#home") !== curHash) { curHash = location.hash || "#home"; route(true); } });

  /* ---------- Install as an app (phones) ---------- */
  let installEvt = null;
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !inFrame) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); installEvt = e;
    if (!standalone()) { $("install-box").hidden = false; $("install-ios").hidden = true; $("install-btn").hidden = false; }
  });
  $("install-btn").addEventListener("click", async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) {}
    installEvt = null; $("install-box").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("install-box").hidden = true; });
  // iPhone: no install prompt, so show the two-tap instructions
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone() && !inFrame) {
    $("install-box").hidden = false; $("install-btn").hidden = true; $("install-ios").hidden = false;
  }

  /* ---------- Start ---------- */
  $("year").textContent = new Date().getFullYear();
  $("contact-email").textContent = C.CONTACT_EMAIL || "";
  if (C.CONTACT_EMAIL) $("menu-contact").href = "mailto:" + C.CONTACT_EMAIL;
  fillTownSelects();
  applyLang();
  if (sb) {
    sb.auth.onAuthStateChange((ev, session) => {
      me = session ? session.user : null;
      if (ev === "PASSWORD_RECOVERY") setTimeout(openRecovery, 0);
      setTimeout(afterAuth, 0); // run Supabase calls outside the auth callback
    });
    loadRecent(); loadTownCounts(); openSharedNotice();
    setInterval(refreshUnread, 30000);
  }
  route();
})();
