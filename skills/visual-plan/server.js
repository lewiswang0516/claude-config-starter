// visual-plan server: serves the interactive plan page and bridges browser <-> Claude.
// No external dependencies (Node built-in http/fs only).
//
// Endpoints:
//   GET  /              -> index.html
//   GET  /vendor/*      -> local static assets (tailwind.js, mermaid.min.js)
//   GET  /api/health    -> {ok:true}
//   GET  /api/plan      -> {version, plan}          (version = monotonic counter)
//   POST /api/plan      -> validates + writes body to plan.json; clears stale submissions
//   GET  /api/poll      -> long-poll, resolves with the next browser submission
//   POST /api/submit    -> browser posts {action, answers, feedback, option}

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.VP_PORT ? Number(process.env.VP_PORT) : 4517;
const RUNTIME = process.env.VP_RUNTIME || '/tmp/claude-visual-plan';
const PLAN_FILE = path.join(RUNTIME, 'plan.json');
const INDEX = path.join(__dirname, 'index.html');

fs.mkdirSync(RUNTIME, { recursive: true });

let waiters = []; // held /api/poll responses
let queue = [];   // pending browser submissions not yet delivered

// Monotonic plan version: seeded from the existing file's mtime so a server
// restart does not reset it below what browsers have already seen.
let planVersion = 0;
try { planVersion = Math.floor(fs.statSync(PLAN_FILE).mtimeMs); } catch (e) {}

function planPayload() {
  try {
    const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
    return { version: planVersion, plan };
  } catch (e) {
    return { version: 0, plan: { title: '等待方案…', summary: 'Claude 还没有推送方案。' } };
  }
}

// ---------- plan schema validation ----------
const isStr = (v) => typeof v === 'string';
const isArr = Array.isArray;

function validatePlan(plan) {
  const errs = [];
  if (!plan || typeof plan !== 'object' || isArr(plan)) return ['plan must be a JSON object'];

  const known = ['title', 'summary', 'architecture', 'steps', 'fileChanges', 'options', 'questions', 'uiPreviews', 'uiImpact'];
  for (const k of Object.keys(plan)) {
    if (!known.includes(k)) errs.push(`unknown field "${k}" (did you misspell one of: ${known.join(', ')}?)`);
  }

  if ('title' in plan && !isStr(plan.title)) errs.push('title must be a string');
  if ('summary' in plan && !isStr(plan.summary)) errs.push('summary must be a string');
  if ('architecture' in plan && !isStr(plan.architecture) && !(plan.architecture && isStr(plan.architecture.mermaid)))
    errs.push('architecture must be a Mermaid string (or {mermaid: string})');

  if ('steps' in plan) {
    if (!isArr(plan.steps)) errs.push('steps must be an array');
    else plan.steps.forEach((s, i) => {
      if (!s || !isStr(s.title)) errs.push(`steps[${i}].title is required (string)`);
      if ('detail' in s && !isStr(s.detail)) errs.push(`steps[${i}].detail must be a string`);
      if ('files' in s && !(isArr(s.files) && s.files.every(isStr))) errs.push(`steps[${i}].files must be an array of paths`);
    });
  }

  if ('fileChanges' in plan) {
    if (!isArr(plan.fileChanges)) errs.push('fileChanges must be an array');
    else plan.fileChanges.forEach((f, i) => {
      if (!f || !isStr(f.path)) errs.push(`fileChanges[${i}].path is required (string)`);
      if (!['add', 'modify', 'delete'].includes(f.action)) errs.push(`fileChanges[${i}].action must be add|modify|delete`);
      if ('note' in f && !isStr(f.note)) errs.push(`fileChanges[${i}].note must be a string`);
      if ('changes' in f && !(isArr(f.changes) && f.changes.every(isStr))) errs.push(`fileChanges[${i}].changes must be an array of strings`);
      if ('diff' in f && !(f.diff && isStr(f.diff.before) && isStr(f.diff.after))) errs.push(`fileChanges[${i}].diff must be {before: string, after: string}`);
      if (f.action !== 'delete' && !(isArr(f.changes) && f.changes.length) && !f.diff)
        errs.push(`fileChanges[${i}] (${f.path || '?'}): add/modify entries must carry "changes" (concrete edits) and/or a "diff"`);
    });
  }

  if ('options' in plan) {
    if (!isArr(plan.options)) errs.push('options must be an array');
    else plan.options.forEach((o, i) => {
      if (!o || !isStr(o.id)) errs.push(`options[${i}].id is required (string)`);
      if (!isStr(o.title)) errs.push(`options[${i}].title is required (string)`);
      if ('summary' in o && !isStr(o.summary)) errs.push(`options[${i}].summary must be a string`);
      if ('pros' in o && !(isArr(o.pros) && o.pros.every(isStr))) errs.push(`options[${i}].pros must be an array of strings`);
      if ('cons' in o && !(isArr(o.cons) && o.cons.every(isStr))) errs.push(`options[${i}].cons must be an array of strings`);
      if ('recommended' in o && typeof o.recommended !== 'boolean') errs.push(`options[${i}].recommended must be a boolean`);
    });
  }

  if ('uiImpact' in plan && !isStr(plan.uiImpact)) errs.push('uiImpact must be a string explaining why UI-file changes have no visible effect');

  if ('uiPreviews' in plan) {
    if (!isArr(plan.uiPreviews)) errs.push('uiPreviews must be an array');
    else plan.uiPreviews.forEach((u, i) => {
      if (!u || !isStr(u.title)) errs.push(`uiPreviews[${i}].title is required (string)`);
      if (!u || !isStr(u.after)) errs.push(`uiPreviews[${i}].after is required (self-contained HTML string)`);
      if (u) {
        if ('before' in u && !isStr(u.before)) errs.push(`uiPreviews[${i}].before must be an HTML string (omit it for brand-new UI)`);
        if ('note' in u && !isStr(u.note)) errs.push(`uiPreviews[${i}].note must be a string`);
        if ('width' in u && typeof u.width !== 'number') errs.push(`uiPreviews[${i}].width must be a number (viewport px)`);
        if ('files' in u && !(isArr(u.files) && u.files.every(isStr))) errs.push(`uiPreviews[${i}].files must be an array of paths`);
      }
    });
  }

  // Frontend changes must come with before/after UI previews (or an explicit uiImpact waiver).
  const UI_EXT = /\.(tsx|jsx|vue|svelte|html?|css|scss|sass|less|styl|astro)$/i;
  const uiFiles = isArr(plan.fileChanges)
    ? plan.fileChanges.filter((f) => f && isStr(f.path) && f.action !== 'delete' && UI_EXT.test(f.path)).map((f) => f.path)
    : [];
  if (uiFiles.length && !(isArr(plan.uiPreviews) && plan.uiPreviews.length) && !isStr(plan.uiImpact)) {
    errs.push(`plan touches frontend files (${uiFiles.slice(0, 5).join(', ')}${uiFiles.length > 5 ? ', …' : ''}) but has no "uiPreviews" — add before/after HTML mockups for each changed component/page, or set "uiImpact" (string) explaining why nothing visible changes`);
  }

  if ('questions' in plan) {
    if (!isArr(plan.questions)) errs.push('questions must be an array');
    else plan.questions.forEach((q, i) => {
      if (!q || !isStr(q.id)) errs.push(`questions[${i}].id is required (string)`);
      if (!isStr(q.question)) errs.push(`questions[${i}].question is required (string)`);
      if (!['single', 'multi', 'text'].includes(q.type)) errs.push(`questions[${i}].type must be single|multi|text`);
      if (q.type !== 'text' && !(isArr(q.options) && q.options.length && q.options.every(isStr)))
        errs.push(`questions[${i}].options is required (non-empty string array) for type "${q.type}"`);
    });
  }

  return errs;
}

function deliver() {
  while (queue.length && waiters.length) {
    const sub = queue.shift();
    const res = waiters.shift();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sub));
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (req.method === 'GET' && p === '/') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && p.startsWith('/vendor/')) {
    const name = path.basename(p); // strips any traversal
    const file = path.join(__dirname, 'vendor', name);
    const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css' };
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': (types[path.extname(name)] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && p === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && p === '/api/plan') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(planPayload()));
    return;
  }

  if (req.method === 'POST' && p === '/api/plan') {
    const body = await readBody(req);
    let plan;
    try {
      plan = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON: ' + e.message }));
      return;
    }
    const errs = validatePlan(plan);
    if (errs.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'schema errors', details: errs }));
      return;
    }
    fs.writeFileSync(PLAN_FILE, body);
    planVersion = Math.max(planVersion + 1, Math.floor(Date.now()));
    queue = []; // a new plan supersedes submissions made against the old one
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: planVersion }));
    return;
  }

  if (req.method === 'GET' && p === '/api/poll') {
    waiters.push(res);
    req.on('close', () => { waiters = waiters.filter((w) => w !== res); });
    deliver();
    return;
  }

  if (req.method === 'POST' && p === '/api/submit') {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body || '{}'); } catch (e) { payload = { raw: body }; }
    payload._ts = Date.now();
    queue.push(payload);
    deliver();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Another instance is already serving this port. Exit quietly so start.sh reuses it.
    console.log('PORT_IN_USE');
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('visual-plan server on http://localhost:' + PORT + ' runtime=' + RUNTIME);
});
