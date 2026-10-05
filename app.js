// Lakaymwen.com — site logic. Talks to Supabase for sign-in, notices and messages.
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
  const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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
    if (!sb) { $("setup-banner").textContent = L().setup; $("setup-banner").hidden = false; }
    if ($("town-filter")) $("town-filter").placeholder = L().town_filter;
    renderTowns();
    renderHaiti();
    renderFeatured(); updateSide();
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
    ["s-town", "pr-town", "r-town"].forEach(id => TOWNS.forEach(t => $(id).add(new Option(t, t))));
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
        el("button", { type: "button", onclick: () => openAuth(t) }, t,
          townCounts[t] ? el("span", { class: "count", text: "(" + townCounts[t] + ")" }) : null))))
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
  function avatar(p, cls) {
    if (p && p.photo_url) {
      const img = el("img", { class: "avatar photo " + (cls || ""), src: p.photo_url, alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.replaceWith(avatar({ display_name: p.display_name }, cls)), { once: true });
      return img;
    }
    return el("div", { class: "avatar " + (cls || ""), "aria-hidden": "true", text: initialsOf(p && p.display_name) });
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
  ["r", "pr"].forEach(p => $(p + "-country").addEventListener("change", () => syncState(p)));
  // Schools: one row per school, like family
  // A school is { name, years }; very old profiles stored just the name as text
  const schoolObj = s => typeof s === "string" ? { name: s, years: "" } : { name: s?.name || "", years: s?.years || "" };
  const schoolText = s => { const o = schoolObj(s); return o.name + (o.years ? ` (${o.years})` : ""); };
  const schoolsOf = p => ((p.school_list && p.school_list.length) ? p.school_list : (p.schools ? p.schools.split(" · ") : [])).map(schoolObj).filter(o => o.name);
  function addSchoolRow(p, value) {
    const box = $(p + "-schools");
    if (box.children.length >= 15) return;
    const v = schoolObj(value);
    const inp = el("input", { type: "text", class: "school-name", maxlength: "80", placeholder: L().school_ph, "aria-label": L().schools });
    const yrs = el("input", { type: "text", class: "school-years", maxlength: "15", inputmode: "numeric", placeholder: L().school_years_ph, "aria-label": L().school_years });
    inp.value = v.name; yrs.value = v.years;
    const row = el("div", { class: "school-row" }, inp, yrs,
      el("button", { class: "fam-x", type: "button", "aria-label": L().remove, text: "×", onclick: () => row.remove() }));
    box.append(row);
    if (!value) inp.focus();
  }
  document.querySelectorAll("[data-add-school]").forEach(b => b.addEventListener("click", () => addSchoolRow(b.dataset.addSchool)));
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
      school_list: readSchools(p), schools: readSchools(p).map(schoolText).join(" · ").slice(0, 300) || null,
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
    $(p + "-lives").value = pr?.lives_in || "";
    $(p + "-schools").replaceChildren();
    (pr ? schoolsOf(pr) : []).forEach(s => addSchoolRow(p, s));
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
      const text = L().tell_text + " " + pageUrl();
      wa(text);
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
  }

  function openDept(d) {
    $("dept-title").textContent = d.name;
    $("dept-cap").textContent = L().dept_cap(d.capital);
    $("dept-towns").replaceChildren(...d.towns.map(t => el("li", {},
      el("button", { type: "button", onclick: () => { $("dlg-dept").close(); me ? openTown(t) : openAuth(t); } }, t,
        townCounts[t] ? el("span", { class: "count", text: String(townCounts[t]) }) : null))));
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
        const members = d.towns.reduce((n, t) => n + (townCounts[t] || 0), 0);
        $("map-tip-name").textContent = d.name;
        $("map-tip-info").textContent = L().map_tip_towns(d.towns.length) + (members ? " · " + L().map_tip_members(members) : "");
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
    const link = pageUrl() + "#notice-" + n.id;
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
        el("a", { class: "btn small ghost", href: "https://wa.me/?text=" + encodeURIComponent(shareText), target: "_blank", rel: "noopener", text: L().share_wa }),
        el("a", { class: "btn small ghost", href: "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link), target: "_blank", rel: "noopener", text: L().share_fb }),
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
  function memberRow(p, key) {
    const self = me && p.id === me.id;
    key = typeof key === "string" ? key : "";
    const hit = txt => key && norm(txt).includes(key);
    const mark = txt => hit(txt) ? el("mark", { text: txt }) : document.createTextNode(txt);
    const glance = (icon, label, items) => items.length ? el("div", { class: "glance" },
      el("span", { class: "g-label", text: icon + " " + label }), el("span", { class: "g-val" },
        ...items.flatMap((it, i) => i ? [document.createTextNode(", "), it] : [it]))) : null;
    const lives = [p.lives_in, p.state, p.country].filter(Boolean).join(", ");
    const schools = schoolsOf(p);
    const fam = p.family || [];
    const famShown = fam.slice(0, 6).concat(fam.slice(6).filter(f => hit(f.name)));
    const famItems = famShown.map(f => el("span", {}, el("i", { text: relName(f.relation) + " " }), mark(f.name)));
    if (fam.length > famShown.length) famItems.push(el("span", { class: "muted", text: L().and_more(fam.length - famShown.length) }));
    return el("div", { class: "member glance-card" },
      el("a", { class: "member-link", href: "#member-" + p.id }, avatar(p, "sm"), el("div", { class: "glance-body" },
        el("b", {}, mark(p.display_name), p.nickname ? el("span", { class: "nick" }, " “", mark(p.nickname), "”") : null, foundingStar(p)),
        el("span", { class: "meta" }, `${L().from} `, mark(p.hometown || ""), p.katye ? [` · ${L().katye_short} `, mark(p.katye)] : null, lives ? ` · ${L().lives} ${lives}` : ""),
        glance("🏫", L().card_schools, schools.map(o => el("span", {}, mark(o.name), o.years ? el("small", { text: ` (${o.years})` }) : null))),
        glance("👪", L().card_family, famItems))),
      self ? null : el("button", { class: "btn small", type: "button", text: L().contact_member,
        onclick: () => openThread({ noticeId: null, other: p.id, title: p.display_name }) })
    );
  }
  async function loadRecent() {}

  /* ---------- Search and results ---------- */
  function renderResults() {
    const r = lastResults;
    $("results").hidden = false;
    $("res-title").textContent = r.title || L().res_title(r.q);
    const found = (r.members || []).filter(notBlocked);
    $("res-members").replaceChildren(...(found.length ? found.map(p => memberRow(p, clean(r.q)))
      : [el("p", { class: "empty", text: L().search_none })]), alertOffer(r.q, r.town, !found.length));
  }
  $("search-form").addEventListener("submit", async e => {
    e.preventDefault();
    say("search-msg", "");
    if (curHash === "#join") route();
    if (!needDb("search-msg")) return;
    if (!me) { say("search-msg", L().search_login); openAuth(null, "login"); return; }
    const q = $("s-name").value.trim(), key = clean(q), town = $("s-town").value;
    if (key.length < 2) { say("search-msg", L().search_short, true); $("s-name").focus(); return; }
    let mq = sb.from("profiles").select(PROFILE_COLS).eq("suspended", false).or(`name_key.ilike.%${key}%,family_key.ilike.%${key}%,place_key.ilike.%${key}%`).order("display_name").limit(100);
    if (town) mq = mq.eq("hometown", town);
    const { data, error } = await mq;
    if (error) { say("search-msg", L().err, true); return; }
    lastResults = { q, town, notices: [], members: data || [] };
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
  let registering = false, pendingReg = null, verifyEmail = "";
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
    email = email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { say(msgId, L().email_bad, true); return; }
    if (btn) btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (btn) btn.disabled = false;
    if (error) {
      if (/confirm/i.test(error.message)) {        // registered but never entered the code
        if ($("dlg-auth").open) $("dlg-auth").close();
        showVerify(email, true);
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
  }

  $("reg-form").addEventListener("submit", async e => {
    e.preventDefault();
    say("join-msg", "");
    const u = $("r-user").value.trim().toLowerCase();
    const email = $("r-email").value.trim().toLowerCase();
    const bad = (msg, field) => { say("join-msg", msg, true); $(field).focus(); $("join-msg").scrollIntoView({ behavior: "smooth", block: "center" }); };
    // required fields, in the order they appear on the page
    if (!USER_RE.test(u)) return bad(L().user_bad, "r-user");
    const ap = aboutProblem("r"); if (ap) return bad(ap[0], ap[1]);
    if (!EMAIL_RE.test(email)) return bad(L().email_bad, "r-email");
    if (!$("r-terms").checked) { /* checked last, below */ }
    if ($("r-pass").value.length < 6) return bad(L().pass_short, "r-pass");
    if ($("r-pass").value !== $("r-pass2").value) return bad(L().pass_mismatch, "r-pass2");
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
      options: { emailRedirectTo: pageUrl(), data: { username: u, profile: about, lang } } });
    done();
    if (error) {
      registering = false;
      if (/already|registered|exists/i.test(error.message)) return bad(L().email_taken, "r-email");
      return bad(L().err + " (" + error.message + ")", "r-email");
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { registering = false; return bad(L().email_taken, "r-email"); }
    pendingReg = { username: u, about, photo: $("r-photo").files[0] || null };
    if (data.session) return finishRegistration(data.session.user);   // email confirmation turned off
    showVerify(email, false);
  });

  $("verify-form").addEventListener("submit", async e => {
    e.preventDefault();
    const token = $("v-code").value.replace(/\D/g, "");
    if (!token) {   // most emails carry a link instead of a code
      const { data: s0 } = await sb.auth.getSession();
      if (s0 && s0.session) { finishRegistration(s0.session.user); return; }
      say("join-msg", L().verify_click_link, true); return;
    }
    if (token.length !== 6) { say("join-msg", L().bad_code, true); $("v-code").focus(); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    registering = true;
    const { data, error } = await sb.auth.verifyOtp({ email: verifyEmail, token, type: "signup" });
    if (btn) btn.disabled = false;
    if (error || !data.session) { registering = false; say("join-msg", L().bad_code, true); $("v-code").focus(); return; }
    finishRegistration(data.session.user);
  });
  $("v-resend").addEventListener("click", async () => {
    if (!verifyEmail) return;
    await sb.auth.resend({ type: "signup", email: verifyEmail });
    say("join-msg", L().code_resent);
  });
  $("v-change").addEventListener("click", () => { showRegForm(); say("join-msg", ""); $("r-email").focus(); });

  // Create the profile once the email is confirmed (also when the code is entered later, after logging in)
  async function finishRegistration(user) {
    me = user;
    const meta = user.user_metadata || {};
    const src = pendingReg || { username: meta.username, about: meta.profile || {}, photo: null };
    let photo_url = null;
    if (src.photo) { try { photo_url = await uploadPhoto(await resizePhoto(src.photo)); } catch (err) { photo_url = null; } }
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
    $("reg-form").reset(); $("r-family").replaceChildren(); $("r-schools").replaceChildren(); showRegForm();
    go("#member-" + user.id);
    afterAuth();
  }

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
    $("forgot-form").hidden = false; $("reset-form").hidden = true; say("forgot-msg", "");
    $("f-email").value = ($("l-email").value || $("side-email").value || "").trim();
    if ($("dlg-auth").open) $("dlg-auth").close();
    openDlg("dlg-forgot"); $("f-email").focus();
  }
  document.querySelectorAll("[data-forgot], [data-forgot-menu]").forEach(b => b.addEventListener("click", openForgot));
  $("forgot-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!needDb("forgot-msg")) return;
    const email = $("f-email").value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { say("forgot-msg", L().email_bad, true); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl() });
    if (btn) btn.disabled = false;
    if (error) { say("forgot-msg", L().err + " (" + error.message + ")", true); return; }
    forgotEmail = email;
    $("reset-text").textContent = L().reset_text(email);
    $("forgot-form").hidden = true; $("reset-form").hidden = false; say("forgot-msg", "");
    $("f-code").focus();
  });
  $("reset-form").addEventListener("submit", async e => {
    e.preventDefault();
    const token = $("f-code").value.replace(/\D/g, "");
    if (!recoveryMode && !token) { say("forgot-msg", L().reset_click_link, true); return; }
    if (!recoveryMode && token.length !== 6) { say("forgot-msg", L().bad_code, true); return; }
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
  $("btn-signout").addEventListener("click", async () => { if (sb) await sb.auth.signOut(); });
  $("join-logout").addEventListener("click", async () => { if (sb) await sb.auth.signOut(); });

  function updateAccount() {
    $("acct-out").hidden = !!me;
    $("acct-in").hidden = !me;
    document.body.classList.toggle("logged-in", !!me);
  }
  async function afterAuth() {
    updateAccount();
    if (!me) { profile = null; blockedIds = new Set(); isAdmin = false; schoolData = null; document.body.classList.remove("is-admin"); $("unread").hidden = true; pymkData = null; renderPymk(); updateSide(); loadFeatured(); loadTownCounts(); refreshAlerts(); if (curHash === "#join" || pageFor(curHash)) route(); if (currentMember) renderMemberPage(currentMember); return; }
    const { data } = await sb.from("profiles").select("*").eq("id", me.id).maybeSingle();
    profile = data || null; schoolData = null;
    say("search-msg", "");
    const [{ data: bl }, { data: adm }] = await Promise.all([sb.from("blocks").select("blocked"), sb.rpc("is_admin")]);
    blockedIds = new Set((bl || []).map(b => b.blocked));
    isAdmin = adm === true; document.body.classList.toggle("is-admin", isAdmin);
    updateSide(); loadFeatured(); loadTownCounts();
    if (curHash === "#admin") renderAdmin();
    if (currentMember) renderMemberPage(currentMember);
    if (!profile && !registering && me.user_metadata && me.user_metadata.profile) { finishRegistration(me); return; }
    if (!profile && !registering) openProfile(true);
    refreshUnread(); refreshAlerts(); syncLangMeta(); loadPymk();
    if (pageFor(curHash)) route();
  }
  // Remember the member's language so alert emails come in Kreyòl or English
  function syncLangMeta() {
    if (sb && me && (me.user_metadata || {}).lang !== lang) sb.auth.updateUser({ data: { lang } }).catch(() => {});
  }

  /* ---------- Profile / my account ---------- */
  async function openProfile(isNew) {
    if (!me) { openAuth(); return; }
    fillAbout("pr", profile);
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
    $("pr-photo-remove").hidden = !(p && p.photo_url);
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
  }
  async function openInbox() {
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
      el("h3", { class: "h3", text: L().open_reports }),
      (reports || []).length ? el("div", { class: "reports" }, ...(reports || []).map(reportRow)) : el("p", { class: "empty", text: L().no_reports }),
      el("h3", { class: "h3", text: L().hidden_members }),
      (hidden || []).length ? el("div", { class: "people" }, ...(hidden || []).map(hiddenRow)) : el("p", { class: "empty", text: L().no_hidden }),
      el("p", { class: "note", text: L().admin_note }));
  }

  /* ---------- WhatsApp invites ---------- */
  const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';
  function wa(text) { window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); }
  function waBtn(label, textFn, extra) {
    const b = el("button", { class: "btn wa" + (extra ? " " + extra : ""), type: "button", onclick: () => wa(textFn()) });
    b.innerHTML = WA_ICON; b.append(el("span", { text: label }));
    return b;
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
      el("div", { class: "row-btns" }, btn, waBtn(L().wa_btn, () => L().inv_search(q, pageUrl()), "ghost-wa")),
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
        waBtn(L().wa_family, () => L().inv_family(profile?.display_name || "", pageUrl() + "#register"))));
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
      el("div", { class: "row-btns place-actions" }, waBtn(L().wa_classmates, () => L().inv_school(display, pageUrl() + schoolHash(display))), addBtn),
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
      el("div", { class: "row-btns place-actions" }, waBtn(L().wa_neighbors, () => L().inv_katye(display, town, pageUrl() + katyeHash(town, display)))),
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
      waBtn(L().wa_photo, () => L().inv_photo(ph.caption || "", pageUrl() + "#photo/" + ph.id), "ghost-wa"),
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
      el("div", { class: "fam-head" }, el("h2", { text: L().fam_on_site }),
        el("a", { class: "btn small dark", href: "#tree/" + p.id, text: "🌳 " + L().tree_btn })),
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
        p.id === me.id ? waBtn(L().wa_family, () => L().inv_tree(p.display_name, pageUrl() + "#tree/" + p.id)) : null),
      linkedN ? el("p", { class: "note", text: L().tree_count(linkedN) }) : null);
  }

  /* ---------- Simple pages: one box shown in the middle column ---------- */
  function pageFor(h) {
    let m;
    const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    if (h === "#alerts") return { box: "alerts-page", render: renderAlerts };
    if (h === "#schools") return { box: "schools-page", render: renderSchools };
    if ((m = h.match(/^#tree\/([0-9a-f-]{36})$/i))) return { box: "tree-page", render: () => renderTree(m[1]) };
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
    document.querySelectorAll("dialog[open]").forEach(d => { if (!(recoveryMode && d.id === "dlg-forgot")) d.close(); });
    if (h !== curHash) {
      curHash = h;
      try { history.pushState(null, "", h); } catch (e) {}
    }
    route(true);
  }
  function route(scroll) {
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
    const search = curHash === "#search";
    document.body.classList.toggle("search-mode", search);
    if (search) { window.scrollTo(0, 0); setTimeout(() => $("s-name").focus(), 60); }
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
      waBtn(L().wa_family, () => L().inv_family(p.display_name, pageUrl() + "#register"))];
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
      actions = [msgBtn, fBtn, waBtn(L().wa_share_profile, () => L().inv_profile(p.display_name, p.hometown, pageUrl() + "#member-" + p.id), "ghost-wa")];
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
      el("div", { class: "profile-chips" },
        p.founding ? el("span", { class: "chip-item founding", text: "★ " + L().founding_badge + (p.old_username ? " · " + p.old_username : "") }) : null,
        el("span", { class: "chip-item red", text: `${L().from} ${p.hometown}` }),
        p.katye ? el("a", { class: "chip-item", href: katyeHash(p.hometown, p.katye), text: `📍 ${L().katye_short} ${p.katye}` }) : null,
        ...schoolsOf(p).map(o => el("a", { class: "chip-item", href: schoolHash(o.name), text: "🏫 " + o.name + (o.years ? ` (${o.years})` : "") })),
        p.lives_in || p.country ? el("span", { class: "chip-item", text: `${L().lives} ${[p.lives_in, p.state, p.country].filter(Boolean).join(", ")}` }) : null,
        el("span", { class: "chip-item", text: L().friend_count(friends.length) })),
      el("div", { class: "profile-body" },
        requestsBox,
        p.bio ? el("p", { class: "profile-bio", text: p.bio }) : null,
        el("section", {}, el("h2", { text: L().sec_family }), family),
        el("section", { class: "profile-family-links", hidden: "" }),
        el("section", {}, el("h2", { text: L().friend_list(p.first_name || p.display_name) }), friendsBox),
        el("section", { class: "profile-photos", hidden: "" })))
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
  fillTownSelects();
  applyLang();
  if (sb) {
    sb.auth.onAuthStateChange((ev, session) => {
      me = session ? session.user : null;
      if (ev === "PASSWORD_RECOVERY") setTimeout(openRecovery, 0);
      setTimeout(afterAuth, 0); // run Supabase calls outside the auth callback
    });
    loadRecent(); loadTownCounts(); openSharedNotice();
    setInterval(refreshUnread, 60000);
  }
  route();
})();
