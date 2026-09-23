"use strict";

/* =====================================================================
   Outils
   ===================================================================== */
const $ = id => document.getElementById(id);

// Construit un élément sans jamais passer par innerHTML (le texte des quiz
// importés reste du texte, jamais du HTML).
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c); });
  return e;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Compare deux réponses texte sans tenir compte des accents, majuscules, ponctuation
function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const narrow = () => window.matchMedia("(max-width: 800px)").matches;

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

/* =====================================================================
   Icônes / mots (réglage « Boutons »)
   Chaque bouton contient les deux versions ; le CSS affiche l'une ou l'autre.
   ===================================================================== */
const svg = d => `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${d}</svg>`;

const I = {
  menu: svg('<path d="M2 4h12M2 8h12M2 12h12"/>'),
  close: svg('<path d="M3 3l10 10M13 3L3 13"/>'),
  gear: svg('<circle cx="8" cy="8" r="2.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2"/>'),
  edit: svg('<path d="M2 14l1-4 8-8 3 3-8 8z"/>'),
  trash: svg('<path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4"/>'),
  plus: svg('<path d="M8 2v12M2 8h12"/>'),
  check: svg('<path d="M2 8l4 4 8-9"/>'),
  up: svg('<path d="M3 10l5-5 5 5"/>'),
  down: svg('<path d="M3 6l5 5 5-5"/>'),
  play: svg('<path d="M4 2l10 6-10 6z"/>'),
  arrow: svg('<path d="M2 8h11M9 4l4 4-4 4"/>'),
  replay: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3"/>')
};

const LABELS = {
  menu:      { w: "MENU",        i: I.menu },
  close:     { w: "FERMER",      i: I.close },
  settings:  { w: "RÉGLAGES",    i: I.gear },
  edit:      { w: "Éditer",      i: I.edit },
  del:       { w: "Suppr.",      i: I.trash },
  addQ:      { w: "Ajouter",     i: I.plus },
  addOpt:    { w: "+ Option",    i: I.plus },
  addAns:    { w: "+ Réponse",   i: I.plus },
  addItem:   { w: "+ Élément",   i: I.plus },
  save:      { w: "Enregistrer", i: I.check },
  cancel:    { w: "Annuler",     i: I.close },
  up:        { w: "Monter",      i: I.up },
  down:      { w: "Descendre",   i: I.down },
  rm:        { w: "Retirer",     i: I.close },
  play:      { w: "Lancer",      i: I.play },
  ok:        { w: "Valider",     i: I.check },
  next:      { w: "Suivant",     i: I.arrow },
  finish:    { w: "Résultat",    i: I.arrow },
  replay:    { w: "Rejouer",     i: I.replay },
  replayErr: { w: "Rejouer les erreurs", i: I.replay },
  quit:      { w: "Quitter",     i: I.close }
};

function setLbl(el, key) {
  const l = LABELS[key];
  el.innerHTML = `<span class="ico">${l.i}</span><span class="wrd">${l.w}</span>`;
  el.title = l.w;
  el.setAttribute("aria-label", l.w);
}

function btn(key, onClick, cls = "") {
  const b = h("button", { type: "button", class: cls, onclick: onClick });
  setLbl(b, key);
  return b;
}

/* =====================================================================
   Données
   Format d'une question :
     tf     { type:"tf", text, correct:true|false }
     choice { type:"choice", text, options:[{text, correct}] }  (1 ou plusieurs bonnes)
     text   { type:"text", text, answers:[…] }                  (plusieurs réponses acceptées)
     list   { type:"list", text, items:[…] }                    (dans le bon ordre)
   Les anciennes questions { text, correct } sont converties en « tf ».
   ===================================================================== */
const STORE_KEY = "quizData";
const SETTINGS_KEY = "quizSettings";

const TYPES = [
  ["tf", "Vrai / Faux"],
  ["choice", "Options personnalisées"],
  ["text", "Saisie de texte"],
  ["list", "Liste à ordonner"]
];
const TYPE_SHORT = { tf: "Vrai/Faux", choice: "Options", text: "Saisie", list: "Liste" };

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = String(raw.text ?? "").trim();
  if (!text) return null;

  let type = raw.type;
  if (!type) {
    type = Array.isArray(raw.options) ? "choice"
         : Array.isArray(raw.answers) ? "text"
         : Array.isArray(raw.items) ? "list"
         : "tf";
  }

  if (type === "tf") {
    const c = raw.correct ?? raw.answer;
    if (typeof c === "boolean") return { type, text, correct: c };
    if (c === "true" || c === "false") return { type, text, correct: c === "true" };
    return null;
  }
  if (type === "choice") {
    if (!Array.isArray(raw.options)) return null;
    const options = raw.options
      .map(o => ({ text: String(o?.text ?? "").trim(), correct: o?.correct === true }))
      .filter(o => o.text);
    if (options.length < 2 || !options.some(o => o.correct)) return null;
    return { type, text, options };
  }
  if (type === "text") {
    const src = Array.isArray(raw.answers) ? raw.answers : raw.answer != null ? [raw.answer] : [];
    const answers = src.map(a => String(a).trim()).filter(Boolean);
    if (!answers.length) return null;
    return { type, text, answers };
  }
  if (type === "list") {
    if (!Array.isArray(raw.items)) return null;
    const items = raw.items.map(i => String(i).trim()).filter(Boolean);
    if (items.length < 2) return null;
    return { type, text, items };
  }
  return null;
}

function loadQuizzes() {
  const raw = loadJSON(STORE_KEY, {});
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [name, list] of Object.entries(raw)) {
      out[name] = Array.isArray(list) ? list.map(normalizeQuestion).filter(Boolean) : [];
    }
  }
  return out;
}

function loadSettings() {
  const d = { accent: "#00ff00", labels: "words", shuffleQuestions: false, shuffleOptions: true };
  const s = loadJSON(SETTINGS_KEY, {});
  return {
    accent: /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent.toLowerCase() : d.accent,
    labels: s.labels === "icons" ? "icons" : "words",
    shuffleQuestions: typeof s.shuffleQuestions === "boolean" ? s.shuffleQuestions : d.shuffleQuestions,
    shuffleOptions: typeof s.shuffleOptions === "boolean" ? s.shuffleOptions : d.shuffleOptions
  };
}

let quizzes = loadQuizzes();
let settings = loadSettings();
let currentQuiz = null;
let play = null;

function save() { localStorage.setItem(STORE_KEY, JSON.stringify(quizzes)); }
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

/* =====================================================================
   Panneaux (menu à gauche, réglages à droite)
   Ils sont indépendants sur grand écran ; sur petit écran un seul à la fois.
   ===================================================================== */
function updateScrim() {
  const open = document.body.classList.contains("menu-open") ||
               document.body.classList.contains("settings-open");
  $("scrim").hidden = !(narrow() && open);
}

function setMenu(open) {
  document.body.classList.toggle("menu-open", open);
  setLbl($("menu-btn"), open ? "close" : "menu");
  $("menu-btn").setAttribute("aria-expanded", String(open));
  if (open) {
    if (narrow()) setSettings(false);
    renderQuizList();
  }
  updateScrim();
}

function setSettings(open) {
  document.body.classList.toggle("settings-open", open);
  setLbl($("settings-btn"), open ? "close" : "settings");
  $("settings-btn").setAttribute("aria-expanded", String(open));
  if (open && narrow()) setMenu(false);
  updateScrim();
}

const isOpen = cls => document.body.classList.contains(cls);

/* =====================================================================
   Réglages
   ===================================================================== */
const ACCENTS = ["#00ff00", "#00ffff", "#ffff00", "#ff00ff", "#ff8800"];

function applySettings() {
  document.documentElement.style.setProperty("--accent", settings.accent);
  document.body.classList.toggle("icons", settings.labels === "icons");
  document.body.classList.toggle("words", settings.labels === "words");

  document.querySelectorAll(".swatch").forEach(b =>
    b.classList.toggle("on", b.dataset.color === settings.accent));
  const custom = $("accent-custom");
  if (custom.value !== settings.accent) custom.value = settings.accent;

  document.querySelectorAll("#seg-labels button").forEach(b =>
    b.classList.toggle("on", b.dataset.value === settings.labels));

  [["shuffleQuestions", "sw-shuffleQ"], ["shuffleOptions", "sw-shuffleO"]].forEach(([key, id]) => {
    const b = $(id);
    b.setAttribute("aria-checked", String(settings[key]));
    b.textContent = settings[key] ? "OUI" : "NON";
  });
}

function initSettingsUI() {
  const box = $("swatches");
  ACCENTS.forEach(c => box.append(h("button", {
    type: "button",
    class: "swatch",
    style: `background:${c}`,
    "data-color": c,
    title: c,
    "aria-label": `Accent ${c}`,
    onclick: () => { settings.accent = c; saveSettings(); applySettings(); }
  })));
  box.append(h("input", {
    type: "color",
    id: "accent-custom",
    value: settings.accent,
    title: "Couleur personnalisée",
    "aria-label": "Couleur personnalisée",
    oninput: e => { settings.accent = e.target.value.toLowerCase(); saveSettings(); applySettings(); }
  }));

  document.querySelectorAll("#seg-labels button").forEach(b => {
    b.onclick = () => { settings.labels = b.dataset.value; saveSettings(); applySettings(); };
  });
  $("sw-shuffleQ").onclick = () => {
    settings.shuffleQuestions = !settings.shuffleQuestions; saveSettings(); applySettings();
  };
  $("sw-shuffleO").onclick = () => {
    settings.shuffleOptions = !settings.shuffleOptions; saveSettings(); applySettings();
  };
}

/* =====================================================================
   Liste des questionnaires (menu)
   ===================================================================== */
function renderQuizList() {
  const list = $("quiz-list");
  list.replaceChildren();
  const names = Object.keys(quizzes);

  if (!names.length) {
    list.append(h("li", { class: "empty-row", text: "Aucun questionnaire pour l'instant." }));
    return;
  }

  names.forEach(name => {
    list.append(h("li", { class: name === currentQuiz ? "active" : "" },
      h("button", { type: "button", class: "plain q-name", text: name, title: "Lancer", onclick: () => startQuiz(name) }),
      h("span", { class: "q-count", text: String(quizzes[name].length) }),
      h("span", { class: "row-actions" },
        btn("edit", () => openEditor(name), "small"),
        btn("del", () => deleteQuiz(name), "small danger"))
    ));
  });
}

function uniqueName(name) {
  let n = name, k = 2;
  while (Object.hasOwn(quizzes, n)) n = `${name} (${k++})`;
  return n;
}

function createQuiz() {
  const name = (prompt("Nom du questionnaire :") || "").trim();
  if (!name) return;
  if (Object.hasOwn(quizzes, name)) return toast("Ce nom existe déjà.");
  quizzes[name] = [];
  save();
  openEditor(name);
}

function deleteQuiz(name) {
  if (!confirm(`Supprimer « ${name} » ?`)) return;
  delete quizzes[name];
  save();
  if (currentQuiz === name) goHome();
  else renderQuizList();
  toast("Questionnaire supprimé.");
}

/* =====================================================================
   Import / export
   ===================================================================== */
function exportAll() {
  const blob = new Blob([JSON.stringify(quizzes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "questionnaires.json";
  a.click();
  URL.revokeObjectURL(url);
}

// Accepte du JSON « propre » ou une réponse d'IA avec ```json … ``` autour
function parseLoose(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* on tente d'extraire l'objet */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* invalide */ }
  }
  return null;
}

// Formats acceptés : { name, questions:[…] }  |  [ …questions ]  |  { "Nom": [ …questions ], … }
function extractQuizzes(data) {
  if (Array.isArray(data)) return [{ name: "Quiz importé", raw: data }];
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.questions)) {
    return [{ name: String(data.name || "").trim() || "Quiz importé", raw: data.questions }];
  }
  return Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([name, raw]) => ({ name, raw }));
}

// Ajoute les quiz sans jamais écraser ceux qui existent déjà
function importFromText(text) {
  const data = parseLoose(text);
  if (data === null) return { error: "Ce n'est pas un JSON valide." };

  const added = [];
  let count = 0, skipped = 0;
  extractQuizzes(data).forEach(({ name, raw }) => {
    const valid = raw.map(normalizeQuestion).filter(Boolean);
    skipped += raw.length - valid.length;
    if (!valid.length) return;
    const finalName = uniqueName(name);
    quizzes[finalName] = valid;
    added.push(finalName);
    count += valid.length;
  });

  if (!added.length) return { error: "Aucune question valide trouvée dans ce JSON." };
  save();
  renderQuizList();
  return {
    added,
    message: `${added.length} questionnaire(s) importé(s), ${count} question(s)` +
             (skipped ? `, ${skipped} ignorée(s)` : "") + "."
  };
}

function importQuiz() {
  const input = h("input", { type: "file", accept: ".json,application/json" });
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importFromText(String(reader.result));
      toast(r.error || r.message);
    };
    reader.readAsText(file);
  };
  input.click();
}

/* =====================================================================
   Créer avec l'IA (popup en 2 étapes)
   ===================================================================== */
function buildPrompt(topic) {
  const subject = topic.trim() || "[écris ici ton sujet ou colle ton cours]";
  return `Tu es un professeur qui prépare un questionnaire de révision.
Crée un quiz à partir du sujet ou du cours donné en bas de ce message.

Réponds UNIQUEMENT avec un JSON valide : pas de texte avant ou après, pas de balises markdown.

Format attendu :
{
  "name": "Titre court du quiz",
  "questions": [
    { "type": "tf", "text": "Une affirmation à juger", "correct": true },
    { "type": "choice", "text": "Une question à options", "options": [
      { "text": "Option A", "correct": true },
      { "text": "Option B", "correct": false },
      { "text": "Option C", "correct": true }
    ] },
    { "type": "text", "text": "Une question à réponse courte", "answers": ["réponse attendue", "autre formulation acceptée"] },
    { "type": "list", "text": "Remets ces éléments dans l'ordre", "items": ["premier", "deuxième", "troisième"] }
  ]
}

Règles :
- "tf" : vrai ou faux, "correct" vaut true ou false.
- "choice" : 3 à 5 options ; une ou plusieurs peuvent être correctes, au moins une l'est.
- "text" : réponse de 1 à 3 mots ; mets dans "answers" toutes les formulations acceptables.
- "list" : 3 à 6 éléments, écrits dans le bon ordre (le quiz les mélange ensuite).
- Mélange les 4 types, écris les questions dans la langue du sujet, environ 10 questions.
- Chaque question doit avoir une seule interprétation possible.

Sujet ou cours :
${subject}`;
}

function openAI() {
  $("new-menu").hidden = true;
  $("new-btn").setAttribute("aria-expanded", "false");
  $("ai-error").hidden = true;
  $("ai-prompt").value = buildPrompt($("ai-topic").value);
  $("ai-modal").hidden = false;
  $("ai-topic").focus();
}

function closeAI() { $("ai-modal").hidden = true; }

async function copyPrompt() {
  const field = $("ai-prompt");
  let ok = false;
  try {
    await navigator.clipboard.writeText(field.value);
    ok = true;
  } catch {
    field.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
  }
  const b = $("ai-copy");
  if (ok) {
    b.textContent = "Copié !";
    setTimeout(() => { b.textContent = "Copier le prompt"; }, 1600);
  } else {
    toast("Copie impossible : sélectionne le texte et copie-le à la main.");
  }
}

function createFromAI() {
  const err = $("ai-error");
  const text = $("ai-paste").value;
  if (!text.trim()) {
    err.textContent = "Colle d'abord la réponse de l'IA.";
    err.hidden = false;
    return;
  }
  const r = importFromText(text);
  if (r.error) {
    err.textContent = `${r.error} Vérifie que tu as collé toute la réponse de l'IA.`;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $("ai-paste").value = "";
  closeAI();
  toast(r.message);
  openEditor(r.added[0]);
}

/* =====================================================================
   Vues
   ===================================================================== */
function render(node) { $("view").replaceChildren(node); }

function goHome() {
  play = null;
  currentQuiz = null;
  renderQuizList();
  render(h("section", {},
    h("h1", { text: "Aucun questionnaire sélectionné" }),
    h("p", { class: "empty", text: "Ouvre le menu pour lancer un questionnaire ou en créer un." })
  ));
}

/* =====================================================================
   Jeu
   Chaque type de question fournit : node, ready(), check(), reveal()
   ===================================================================== */
function buildTF(q, onChange) {
  let val = null, locked = false;
  const items = [];
  const wrap = h("div", { class: "opts" });

  [["Vrai", true], ["Faux", false]].forEach(([label, v]) => {
    const b = h("button", {
      type: "button", class: "opt", text: label,
      onclick: () => {
        if (locked) return;
        val = v;
        items.forEach(x => x.b.classList.toggle("sel", x.v === v));
        onChange();
      }
    });
    items.push({ b, v });
    wrap.append(b);
  });

  return {
    node: wrap,
    ready: () => val !== null,
    check: () => ({
      ok: val === q.correct,
      given: val === null ? "—" : val ? "Vrai" : "Faux",
      expected: q.correct ? "Vrai" : "Faux"
    }),
    reveal() {
      locked = true;
      items.forEach(({ b, v }) => {
        b.disabled = true;
        if (v === q.correct) b.classList.add("right");
        else if (b.classList.contains("sel")) b.classList.add("wrong");
      });
    }
  };
}

function buildChoice(q, onChange) {
  const good = q.options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0);
  const multi = good.length > 1;
  let order = q.options.map((_, i) => i);
  if (settings.shuffleOptions) order = shuffle(order);

  const sel = new Set();
  let locked = false;
  const rows = [];
  const wrap = h("div", { class: "opts" });

  order.forEach(idx => {
    const b = h("button", { type: "button", class: "opt " + (multi ? "multi" : "single") },
      h("span", { class: "mark" }),
      h("span", { class: "opt-text", text: q.options[idx].text }));
    b.onclick = () => {
      if (locked) return;
      if (multi) { sel.has(idx) ? sel.delete(idx) : sel.add(idx); }
      else { sel.clear(); sel.add(idx); }
      rows.forEach(r => r.b.classList.toggle("sel", sel.has(r.idx)));
      onChange();
    };
    rows.push({ b, idx });
    wrap.append(b);
  });

  return {
    node: h("div", {}, multi ? h("p", { class: "hint", text: "Plusieurs réponses possibles." }) : null, wrap),
    ready: () => sel.size > 0,
    check: () => ({
      ok: good.length === sel.size && good.every(i => sel.has(i)),
      given: [...sel].sort((a, b) => a - b).map(i => q.options[i].text).join(", ") || "—",
      expected: good.map(i => q.options[i].text).join(", ")
    }),
    reveal() {
      locked = true;
      rows.forEach(({ b, idx }) => {
        b.disabled = true;
        if (q.options[idx].correct) b.classList.add("right");
        else if (sel.has(idx)) b.classList.add("wrong");
      });
    }
  };
}

function buildText(q, onChange) {
  const input = h("input", {
    type: "text", class: "text-answer", placeholder: "Ta réponse…",
    autocomplete: "off", spellcheck: false, oninput: onChange
  });
  const result = () => {
    const v = norm(input.value);
    return {
      ok: q.answers.some(a => norm(a) === v),
      given: input.value.trim(),
      expected: q.answers.join(" / ")
    };
  };
  return {
    node: input,
    ready: () => input.value.trim() !== "",
    focus: () => input.focus(),
    check: result,
    reveal() {
      input.disabled = true;
      input.classList.add(result().ok ? "right" : "wrong");
    }
  };
}

function buildList(q, onChange) {
  // Mélange, en évitant de tomber par hasard sur le bon ordre
  let items = q.items.map(t => ({ t }));
  for (let n = 0; n < 5; n++) {
    items = shuffle(items);
    if (items.some((it, k) => it.t !== q.items[k])) break;
  }

  let order = [];          // indices (dans `items`) dans l'ordre choisi par le joueur
  let locked = false;
  const pool = h("div", { class: "chips" });
  const seq = h("ol", { class: "seq" });

  function draw() {
    pool.replaceChildren();
    seq.replaceChildren();

    items.forEach((it, k) => {
      if (order.includes(k)) return;
      pool.append(h("button", {
        type: "button", class: "chip", text: it.t, disabled: locked,
        onclick: () => { order.push(k); draw(); onChange(); }
      }));
    });

    order.forEach((k, pos) => {
      const status = locked ? (items[k].t === q.items[pos] ? " right" : " wrong") : "";
      seq.append(h("li", {}, h("button", {
        type: "button", class: "chip placed" + status, text: items[k].t, disabled: locked,
        title: "Retirer",
        onclick: () => { order.splice(pos, 1); draw(); onChange(); }
      })));
    });
  }
  draw();

  return {
    node: h("div", {},
      h("p", { class: "hint", text: "Clique les éléments dans l'ordre. Clique sur un élément placé pour le retirer." }),
      pool, seq),
    ready: () => order.length === items.length,
    check: () => ({
      ok: order.length === q.items.length && order.every((k, pos) => items[k].t === q.items[pos]),
      given: order.map(k => items[k].t).join(" → "),
      expected: q.items.join(" → ")
    }),
    reveal() { locked = true; draw(); }
  };
}

function startQuiz(name, subset) {
  const src = subset || quizzes[name];
  if (!src || !src.length) {
    toast("Ce questionnaire est vide : ajoute des questions.");
    openEditor(name);
    return;
  }
  currentQuiz = name;
  play = {
    name,
    qs: settings.shuffleQuestions ? shuffle(src) : [...src],
    i: 0,
    results: []
  };
  renderQuizList();
  if (narrow()) setMenu(false);
  renderPlay();
}

function renderPlay() {
  const p = play, q = p.qs[p.i];
  const last = p.i === p.qs.length - 1;
  const builder = { tf: buildTF, choice: buildChoice, text: buildText, list: buildList }[q.type];

  const okBtn = btn("ok", validate, "primary");
  okBtn.disabled = true;
  const nextBtn = btn(last ? "finish" : "next", goNext, "primary");
  nextBtn.hidden = true;
  const feedback = h("div", { class: "feedback", hidden: true });
  const ctrl = builder(q, () => { okBtn.disabled = !ctrl.ready(); });

  function validate() {
    if (nextBtn.hidden === false || !ctrl.ready()) return;
    const r = ctrl.check();
    ctrl.reveal();
    p.results.push({ q, ...r });
    okBtn.hidden = true;
    nextBtn.hidden = false;
    feedback.hidden = false;
    feedback.className = "feedback " + (r.ok ? "right" : "wrong");
    feedback.replaceChildren(
      h("strong", { text: r.ok ? "Correct !" : "Raté." }),
      r.ok ? null : h("p", { text: "Réponse attendue : " + r.expected })
    );
    nextBtn.focus();
  }

  function goNext() {
    p.i++;
    if (p.i >= p.qs.length) renderResult();
    else renderPlay();
  }

  if (q.type === "text") {
    ctrl.node.addEventListener("keydown", e => { if (e.key === "Enter") validate(); });
  }

  render(h("section", {},
    h("div", { class: "topline" },
      h("h1", { text: p.name }),
      btn("quit", goHome)),
    h("div", { class: "count", text: `Question ${p.i + 1} / ${p.qs.length}` }),
    h("div", { class: "bar" }, h("i", { style: `width:${(p.i / p.qs.length) * 100}%` })),
    h("h2", { class: "question", text: q.text }),
    ctrl.node,
    feedback,
    h("div", { class: "actions" }, okBtn, nextBtn)
  ));

  window.scrollTo(0, 0);
  if (ctrl.focus) ctrl.focus();
}

function renderResult() {
  const p = play;
  const total = p.results.length;
  const good = p.results.filter(r => r.ok).length;
  const wrong = p.results.filter(r => !r.ok);
  const pct = total ? Math.round((good / total) * 100) : 0;

  render(h("section", {},
    h("h1", { text: p.name }),
    h("div", { class: "score" }, `${good} / ${total} `, h("small", { text: `${pct} %` })),
    h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })),
    wrong.length
      ? h("div", { class: "review" },
          h("h3", { text: "À revoir" }),
          h("ul", {}, wrong.map(r => h("li", {},
            h("div", { text: r.q.text }),
            h("div", { class: "got", text: "Ta réponse : " + r.given }),
            h("div", { class: "exp", text: "Attendu : " + r.expected })))))
      : h("p", { class: "empty", text: "Aucune erreur." }),
    h("div", { class: "actions" },
      btn("replay", () => startQuiz(p.name), "primary"),
      wrong.length ? btn("replayErr", () => startQuiz(p.name, wrong.map(r => r.q))) : null,
      btn("edit", () => openEditor(p.name)),
      btn("quit", goHome))
  ));
  window.scrollTo(0, 0);
}

/* =====================================================================
   Éditeur
   L'état du formulaire vit dans `ed` : on peut donc tout redessiner
   sans perdre ce qui a été tapé.
   ===================================================================== */
const blankEd = (type = "tf") => ({
  index: null,
  type,
  text: "",
  correct: true,
  options: [{ text: "", correct: false }, { text: "", correct: false }],
  answers: [""],
  items: ["", ""]
});
let ed = blankEd();

function summary(q) {
  if (q.type === "tf") return q.correct ? "Vrai" : "Faux";
  if (q.type === "choice") return q.options.filter(o => o.correct).map(o => o.text).join(", ");
  if (q.type === "text") return q.answers.join(" / ");
  return q.items.join(" → ");
}

function openEditor(name) {
  currentQuiz = name;
  play = null;
  ed = blankEd();
  renderQuizList();
  if (narrow()) setMenu(false);
  renderEditor();
}

function editQuestion(i) {
  const q = quizzes[currentQuiz][i];
  ed = { ...blankEd(q.type), index: i, text: q.text };
  if (q.type === "tf") ed.correct = q.correct;
  if (q.type === "choice") ed.options = q.options.map(o => ({ ...o }));
  if (q.type === "text") ed.answers = [...q.answers];
  if (q.type === "list") ed.items = [...q.items];
  renderEditor();
  $("ed-text").focus();
  $("ed-text").scrollIntoView({ block: "center" });
}

function deleteQuestion(i) {
  quizzes[currentQuiz].splice(i, 1);
  if (ed.index === i) ed = blankEd(ed.type);
  else if (ed.index !== null && ed.index > i) ed.index--;
  save();
  renderQuizList();
  renderEditor();
}

function renderEditor() {
  const name = currentQuiz;
  const qs = quizzes[name];

  const fields = h("div", { class: "fields" });
  const err = h("p", { class: "error", hidden: true });

  const typeSel = h("select", { id: "ed-type", onchange: () => { ed.type = typeSel.value; drawFields(); } },
    TYPES.map(([v, l]) => h("option", { value: v, text: l })));
  typeSel.value = ed.type;

  const textIn = h("input", {
    type: "text", id: "ed-text", placeholder: "Écrire une question…", value: ed.text,
    oninput: () => { ed.text = textIn.value; }
  });

  const row = (...kids) => h("div", { class: "field-row" }, ...kids);
  const focusLast = () => {
    const ins = fields.querySelectorAll('input[type="text"]');
    if (ins.length) ins[ins.length - 1].focus();
  };

  function drawFields(focus) {
    fields.replaceChildren();
    err.hidden = true;

    if (ed.type === "tf") {
      const s = h("select", { onchange: () => { ed.correct = s.value === "true"; } },
        h("option", { value: "true", text: "Vrai" }),
        h("option", { value: "false", text: "Faux" }));
      s.value = String(ed.correct);
      fields.append(h("label", { text: "Bonne réponse" }), s);
    }

    if (ed.type === "choice") {
      fields.append(h("p", { class: "hint", text: "Coche les bonnes réponses : une ou plusieurs." }));
      ed.options.forEach((o, i) => {
        fields.append(row(
          h("input", { type: "checkbox", checked: o.correct, title: "Bonne réponse", "aria-label": "Bonne réponse",
                       onchange: e => { o.correct = e.target.checked; } }),
          h("input", { type: "text", placeholder: `Option ${i + 1}`, value: o.text,
                       oninput: e => { o.text = e.target.value; } }),
          ed.options.length > 2 ? btn("rm", () => { ed.options.splice(i, 1); drawFields(); }, "small") : null));
      });
      if (ed.options.length < 8) {
        fields.append(btn("addOpt", () => { ed.options.push({ text: "", correct: false }); drawFields(true); }, "small"));
      }
    }

    if (ed.type === "text") {
      fields.append(h("p", { class: "hint", text: "Réponses acceptées. Majuscules, accents et ponctuation sont ignorés." }));
      ed.answers.forEach((a, i) => {
        fields.append(row(
          h("input", { type: "text", placeholder: i === 0 ? "Bonne réponse" : "Autre réponse acceptée", value: a,
                       oninput: e => { ed.answers[i] = e.target.value; } }),
          ed.answers.length > 1 ? btn("rm", () => { ed.answers.splice(i, 1); drawFields(); }, "small") : null));
      });
      fields.append(btn("addAns", () => { ed.answers.push(""); drawFields(true); }, "small"));
    }

    if (ed.type === "list") {
      fields.append(h("p", { class: "hint", text: "Écris les éléments dans le bon ordre, de haut en bas. Ils seront mélangés pendant le quiz." }));
      const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= ed.items.length) return;
        [ed.items[i], ed.items[j]] = [ed.items[j], ed.items[i]];
        drawFields();
      };
      ed.items.forEach((it, i) => {
        const up = btn("up", () => move(i, -1), "small");
        const down = btn("down", () => move(i, 1), "small");
        up.disabled = i === 0;
        down.disabled = i === ed.items.length - 1;
        fields.append(row(
          h("span", { class: "num", text: `${i + 1}.` }),
          h("input", { type: "text", placeholder: `Élément ${i + 1}`, value: it,
                       oninput: e => { ed.items[i] = e.target.value; } }),
          up, down,
          ed.items.length > 2 ? btn("rm", () => { ed.items.splice(i, 1); drawFields(); }, "small") : null));
      });
      if (ed.items.length < 10) {
        fields.append(btn("addItem", () => { ed.items.push(""); drawFields(true); }, "small"));
      }
    }

    if (focus) focusLast();
  }

  function submit() {
    const text = ed.text.trim();
    let raw = null, msg = null;

    if (!text) msg = "Écris la question.";
    else if (ed.type === "tf") raw = { type: "tf", text, correct: ed.correct };
    else if (ed.type === "choice") {
      const options = ed.options.map(o => ({ text: o.text.trim(), correct: o.correct })).filter(o => o.text);
      if (options.length < 2) msg = "Ajoute au moins 2 options.";
      else if (!options.some(o => o.correct)) msg = "Coche au moins une bonne réponse.";
      else raw = { type: "choice", text, options };
    } else if (ed.type === "text") {
      const answers = ed.answers.map(a => a.trim()).filter(Boolean);
      if (!answers.length) msg = "Ajoute au moins une réponse.";
      else raw = { type: "text", text, answers };
    } else {
      const items = ed.items.map(i => i.trim()).filter(Boolean);
      if (items.length < 2) msg = "Ajoute au moins 2 éléments.";
      else raw = { type: "list", text, items };
    }

    const q = raw && normalizeQuestion(raw);
    if (!q) {
      err.textContent = msg || "Question invalide.";
      err.hidden = false;
      return;
    }

    if (ed.index === null) quizzes[name].push(q);
    else quizzes[name][ed.index] = q;
    save();
    renderQuizList();
    ed = blankEd(ed.type);
    renderEditor();
    $("ed-text").focus();
  }

  drawFields();

  const editing = ed.index !== null;
  const form = h("div", { class: "card" },
    h("h3", { text: editing ? `Modifier la question ${ed.index + 1}` : "Nouvelle question" }),
    h("label", { for: "ed-type", text: "Type" }), typeSel,
    h("label", { for: "ed-text", text: "Question" }), textIn,
    h("div", { style: "margin-top:12px" }, fields),
    err,
    h("div", { class: "actions" },
      btn(editing ? "save" : "addQ", submit, "primary"),
      editing ? btn("cancel", () => { ed = blankEd(ed.type); renderEditor(); }) : null));

  const list = h("ul", { id: "qlist" }, qs.map((q, i) => h("li", {},
    h("span", { class: "num", text: `${i + 1}.` }),
    h("div", { class: "q-body" },
      h("div", { class: "q-text", text: q.text }),
      h("div", { class: "q-answer", text: summary(q) })),
    h("span", { class: "badge", text: TYPE_SHORT[q.type] }),
    h("span", { class: "q-tools" },
      btn("edit", () => editQuestion(i), "small"),
      btn("del", () => deleteQuestion(i), "small danger")))));

  render(h("section", {},
    h("div", { class: "topline" },
      h("h1", { text: name }),
      btn("play", () => startQuiz(name), "primary")),
    h("p", { class: "count", text: `${qs.length} question${qs.length > 1 ? "s" : ""}` }),
    form,
    h("h3", { text: "Questions" }),
    qs.length ? list : h("p", { class: "empty", text: "Aucune question pour l'instant." })
  ));
}

/* =====================================================================
   Démarrage
   ===================================================================== */
function init() {
  document.querySelectorAll("[data-lbl]").forEach(el => setLbl(el, el.dataset.lbl));
  initSettingsUI();
  applySettings();

  $("menu-btn").onclick = () => setMenu(!isOpen("menu-open"));
  $("settings-btn").onclick = () => setSettings(!isOpen("settings-open"));
  $("scrim").onclick = () => { setMenu(false); setSettings(false); };

  $("new-btn").onclick = () => {
    const m = $("new-menu");
    m.hidden = !m.hidden;
    $("new-btn").setAttribute("aria-expanded", String(!m.hidden));
  };
  $("new-create").onclick = () => { $("new-menu").hidden = true; createQuiz(); };
  $("new-import").onclick = () => { $("new-menu").hidden = true; importQuiz(); };
  $("new-ai").onclick = openAI;
  $("export-btn").onclick = exportAll;

  $("ai-close").onclick = closeAI;
  $("ai-modal").addEventListener("mousedown", e => { if (e.target === $("ai-modal")) closeAI(); });
  $("ai-topic").oninput = () => { $("ai-prompt").value = buildPrompt($("ai-topic").value); };
  $("ai-copy").onclick = copyPrompt;
  $("ai-create").onclick = createFromAI;

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("ai-modal").hidden) closeAI();
    else { setMenu(false); setSettings(false); }
  });

  window.matchMedia("(max-width: 800px)").addEventListener("change", () => {
    if (narrow() && isOpen("menu-open") && isOpen("settings-open")) setSettings(false);
    updateScrim();
  });

  save(); // enregistre les anciennes questions converties au nouveau format
  setMenu(false);
  setSettings(false);
  goHome();
}

init();
