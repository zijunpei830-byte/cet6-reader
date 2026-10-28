/* 全球高考 · 六级词汇阅读器 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LS = {
    vocab: 'gqg.vocab.v1',
    notes: 'gqg.notes.v1',
    pos: 'gqg.pos.v1',
    read: 'gqg.read.v1',
    ui: 'gqg.ui.v1',
  };

  const state = {
    toc: [],
    words: {},
    idx: 0,          // 当前章节在 toc 中的下标
    chapter: null,
    ui: { fs: 19, theme: 'light' },
    vocab: {},       // word -> 收藏时间戳
    notes: {},       // word -> 手写笔记
    read: new Set(),
    view: 'reader',
  };
  const cache = new Map();   // 章节 JSON 缓存
  let cardWord = null;
  let noteTimer = 0;

  /* ---------------- 本地存储 ---------------- */
  const readJSON = (k, d) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; }
    catch { return d; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function loadStores() {
    state.vocab = readJSON(LS.vocab, {}) || {};
    state.notes = readJSON(LS.notes, {}) || {};
    const ui = readJSON(LS.ui, null);
    if (ui) state.ui = Object.assign(state.ui, ui);
    const r = readJSON(LS.read, []);
    state.read = new Set(Array.isArray(r) ? r : []);
  }
  const saveVocab = () => writeJSON(LS.vocab, state.vocab);
  const saveUi = () => writeJSON(LS.ui, state.ui);
  const saveRead = () => writeJSON(LS.read, [...state.read]);

  /* ---------------- 视图工具 ---------------- */
  function applyTheme() {
    document.documentElement.dataset.theme = state.ui.theme;
    const sw = $('themeSwitch');
    sw.setAttribute('aria-checked', String(state.ui.theme === 'dark'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = state.ui.theme === 'dark' ? '#15181d' : '#f7f5f0';
  }
  function applyFont() {
    document.documentElement.style.setProperty('--fs', state.ui.fs + 'px');
  }

  function switchView(view) {
    state.view = view;
    const reader = $('viewReader');
    const vocab = $('viewVocab');
    if (view === 'vocab') {
      reader.hidden = true;
      vocab.hidden = false;
      $('vocabIcon').textContent = '←';
      $('vocabLabel').textContent = '返回阅读';
      $('vocabBadge').hidden = true;
      renderVocab();
      window.scrollTo(0, 0);
    } else {
      vocab.hidden = true;
      reader.hidden = false;
      $('vocabIcon').textContent = '📖';
      $('vocabLabel').textContent = '生词本';
      updateVocabBadge();
      const p = lastPos;
      requestAnimationFrame(() => window.scrollTo(0, p.y || 0));
    }
  }

  /* ---------------- 目录抽屉 ---------------- */
  function openToc(open) {
    const d = $('tocDrawer'), b = $('backdrop');
    d.classList.toggle('on', open);
    d.setAttribute('aria-hidden', String(!open));
    b.hidden = !open;
    if (open) requestAnimationFrame(() => b.classList.add('on'));
    else b.classList.remove('on');
    if (open) {
      const active = document.querySelector('.tocrow.active');
      if (active) active.scrollIntoView({ block: 'center' });
    }
  }

  function renderToc(filter = '') {
    const list = $('tocList');
    const q = filter.trim();
    const rows = [];
    state.toc.forEach((c, i) => {
      if (q) {
        const m = c.t.toLowerCase().includes(q.toLowerCase()) || String(c.i) === q;
        if (!m) return;
      }
      rows.push(
        `<div class="tocrow${i === state.idx ? ' active' : ''}${state.read.has(c.i) ? ' read' : ''}" data-i="${i}">` +
        `<span class="t">${escapeHtml(c.t)}</span><span class="n">${c.n}词</span></div>`
      );
    });
    list.innerHTML = rows.length ? rows.join('') : '<div class="vempty" style="padding:36px 8px">没有找到这一章</div>';
  }

  /* ---------------- 章节 ---------------- */
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function fetchChapter(i) {
    if (cache.has(i)) return cache.get(i);
    const r = await fetch(`ch/${String(i).padStart(3, '0')}.json`, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    cache.set(i, d);
    return d;
  }

  function splitTitle(t) {
    const m = /^(第[0-9０-９一二三四五六七八九十百零两]+章)\s*(.*)$/.exec(t);
    return m ? { no: m[1], name: m[2] || t } : { no: '', name: t };
  }

  async function openChapter(i, opts = {}) {
    if (i < 0 || i >= state.toc.length) return;
    const meta = state.toc[i];
    state.idx = i;
    const page = $('page');
    page.innerHTML = '<div class="loading">正在翻开书页…</div>';
    let data;
    try {
      data = await fetchChapter(meta.i);
    } catch (e) {
      page.innerHTML = '<div class="loading">这一章没加载出来。检查一下网络，再点一次目录试试。</div>';
      return;
    }
    state.chapter = data;
    const { no, name } = splitTitle(data.t);
    const body = data.p.map((p) => {
      const cls = p.startsWith('【') ? ' class="sys"' : '';
      return `<p${cls}>${p}</p>`;
    }).join('');

    page.innerHTML =
      `<div class="chaphead"><div class="chapno">${escapeHtml(no || '正文')}</div>` +
      `<h1 class="chaptitle">${escapeHtml(name)}</h1></div>` + body;

    markSavedWords();
    renderChapterNav(i);
    markRead(i);
    if (!opts.keepScroll) window.scrollTo(0, 0);
    else if (opts.y) requestAnimationFrame(() => window.scrollTo(0, opts.y));
    lastPos = { i: i, y: opts.y || 0 };
    writeJSON(LS.pos, lastPos);
    updateProgressBar();

    // 预取下一章
    if (i + 1 < state.toc.length) fetchChapter(state.toc[i + 1].i).catch(() => {});
  }

  function renderChapterNav(i) {
    const nav = $('chapternav');
    const prev = state.toc[i - 1], next = state.toc[i + 1];
    nav.innerHTML =
      `<button type="button" data-step="-1" ${prev ? '' : 'disabled'}>← ${prev ? escapeHtml(shortTitle(prev.t)) : '已经是第一章'}</button>` +
      `<button type="button" data-step="1" class="next" ${next ? '' : 'disabled'}>${next ? escapeHtml(shortTitle(next.t)) : '全书完'} →</button>`;
  }
  const shortTitle = (t) => {
    const { no, name } = splitTitle(t);
    return (no + ' ' + name).trim().slice(0, 14);
  };

  function markRead(i) {
    state.read.add(state.toc[i].i);
    saveRead();
    const row = document.querySelector(`.tocrow[data-i="${i}"]`);
    if (row) row.classList.add('read');
    document.querySelectorAll('.tocrow').forEach((r) => r.classList.toggle('active', Number(r.dataset.i) === i));
  }

  /* ---------------- 进度条 / 滚动保存 ---------------- */
  function updateProgressBar() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const p = h > 60 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
    $('progressbar').style.width = (p * 100).toFixed(2) + '%';
  }
  let lastPos = { i: 0, y: 0 };
  let scrollTimer = 0;
  window.addEventListener('scroll', () => {
    updateProgressBar();
    if (state.view !== 'reader' || !state.chapter) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      lastPos = { i: state.idx, y: Math.round(window.scrollY) };
      writeJSON(LS.pos, lastPos);
    }, 350);
  }, { passive: true });

  /* ---------------- 单词卡片 ---------------- */
  function flushNote() {
    clearTimeout(noteTimer);
    noteTimer = 0;
    const ta = $('wcNote');
    if (!cardWord || !ta) return;
    const v = ta.value.trim();
    if (v) state.notes[cardWord] = v;
    else delete state.notes[cardWord];
    writeJSON(LS.notes, state.notes);
  }
  function flashSaved() {
    const el = $('noteState');
    el.textContent = '已保存 ✓';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 1400);
  }

  function openCard(word) {
    const w = state.words[word];
    if (!w) return;
    if (cardWord && cardWord !== word) flushNote();
    cardWord = word;
    $('wcWord').textContent = w.w;
    $('wcIpa').textContent = w.ipa || '';
    $('wcPos').textContent = w.pos || '';
    $('wcZh').textContent = w.zh || '';
    $('wcColloc').innerHTML = (w.colloc || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    $('wcFamily').textContent = w.family ? ('词族：' + w.family) : '';
    $('wcCount').textContent = w.n ? `全书出现 ${w.n} 次` : '';
    $('wcNote').value = state.notes[word] || '';
    $('noteState').textContent = '';
    syncFavButton();
    const card = $('wordcard');
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('on'));
  }
  function closeCard() {
    flushNote();
    const card = $('wordcard');
    card.classList.remove('on');
    cardWord = null;
    setTimeout(() => { if (!card.classList.contains('on')) card.hidden = true; }, 200);
  }
  function syncFavButton() {
    const btn = $('wcFav');
    const on = !!state.vocab[cardWord];
    btn.textContent = on ? '已收藏 ✓' : '收藏';
    btn.classList.toggle('on', on);
  }
  function toggleFav(word) {
    if (!word) return;
    if (state.vocab[word]) delete state.vocab[word];
    else state.vocab[word] = Date.now();
    saveVocab();
    syncFavButton();
    markSavedWords();
    updateVocabBadge();
    if (state.view === 'vocab') renderVocab();
  }
  function markSavedWords() {
    document.querySelectorAll('.w').forEach((el) => {
      el.classList.toggle('saved', !!state.vocab[el.dataset.w]);
    });
  }
  function updateVocabBadge() {
    const n = Object.keys(state.vocab).length;
    const b = $('vocabBadge');
    b.textContent = String(n);
    b.hidden = n === 0 || state.view === 'vocab';
  }

  /* ---------------- 生词本 ---------------- */
  function renderVocab() {
    const list = $('vocabList');
    const entries = Object.keys(state.vocab)
      .sort((a, b) => state.vocab[b] - state.vocab[a])
      .map((k) => state.words[k] || { w: k, ipa: '', pos: '', zh: '', colloc: [] });
    $('vocabSub').textContent = entries.length
      ? `收集了 ${entries.length} 个词。点删除可以移出生词本。`
      : '点正文里的英文单词，卡片里可以收藏。';
    if (!entries.length) {
      list.innerHTML = '<li class="vempty"><b>生词本还是空的</b>读到不熟的词，点一下正文里的英文，<br>卡片下方点「收藏」就会留在这里。</li>';
      return;
    }
    list.innerHTML = entries.map((w) => `
      <li class="vitem">
        <div class="vmain">
          <div class="vword">${escapeHtml(w.w)}<span class="vipa">${escapeHtml(w.ipa || '')}</span></div>
          <div class="vmean">${w.pos ? `<span class="wc-pos" style="margin-right:6px">${escapeHtml(w.pos)}</span>` : ''}${escapeHtml(w.zh || '')}</div>
          ${(w.colloc && w.colloc[0]) ? `<div class="vcolloc">${escapeHtml(w.colloc[0])}</div>` : ''}
        </div>
        <button class="vdel" type="button" data-del="${escapeHtml(w.w)}">删除</button>
      </li>`).join('');
  }

  /* ---------------- 朗读 ---------------- */
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch {}
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('btnToc').addEventListener('click', () => openToc(true));
    $('backdrop').addEventListener('click', () => openToc(false));
    $('btnVocab').addEventListener('click', () => switchView(state.view === 'vocab' ? 'reader' : 'vocab'));

    $('tocSearch').addEventListener('input', (e) => renderToc(e.target.value));
    $('tocList').addEventListener('click', (e) => {
      const row = e.target.closest('.tocrow');
      if (!row) return;
      openToc(false);
      openChapter(Number(row.dataset.i));
    });

    document.querySelectorAll('[data-font]').forEach((b) => {
      b.addEventListener('click', () => {
        state.ui.fs = Math.min(24, Math.max(16, state.ui.fs + Number(b.dataset.font)));
        applyFont();
        saveUi();
      });
    });
    $('themeSwitch').addEventListener('click', () => {
      state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveUi();
    });

    $('page').addEventListener('click', (e) => {
      const el = e.target.closest('.w');
      if (el) { openCard(el.dataset.w); return; }
      if (!$('wordcard').hidden) closeCard();
    });
    $('wcClose').addEventListener('click', closeCard);
    $('wcFav').addEventListener('click', () => toggleFav(cardWord));
    $('wcSpeak').addEventListener('click', () => cardWord && speak(cardWord));
    $('wcNote').addEventListener('input', () => {
      clearTimeout(noteTimer);
      $('noteState').textContent = '';
      noteTimer = setTimeout(() => { flushNote(); flashSaved(); }, 450);
    });
    $('wcNote').addEventListener('blur', () => { if (noteTimer) { flushNote(); flashSaved(); } });
    $('wordcard').addEventListener('click', (e) => { if (e.target.id === 'wordcard') closeCard(); });

    $('chapternav').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-step]');
      if (!b || b.disabled) return;
      openChapter(state.idx + Number(b.dataset.step));
    });

    $('vocabList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      delete state.vocab[b.dataset.del];
      saveVocab();
      markSavedWords();
      updateVocabBadge();
      renderVocab();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('wordcard').hidden) return closeCard();
        if ($('tocDrawer').classList.contains('on')) return openToc(false);
      }
      if (state.view !== 'reader' || !$('wordcard').hidden) return;
      if (e.key === 'ArrowRight') openChapter(state.idx + 1);
      if (e.key === 'ArrowLeft') openChapter(state.idx - 1);
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    loadStores();
    applyTheme();
    applyFont();
    updateVocabBadge();
    bind();
    try {
      const [toc, words] = await Promise.all([
        fetch('toc.json', { cache: 'force-cache' }).then((r) => r.json()),
        fetch('words.json', { cache: 'force-cache' }).then((r) => r.json()),
      ]);
      state.toc = toc;
      state.words = words;
    } catch (err) {
      $('page').innerHTML = '<div class="loading">目录没读到。刷新一下页面。</div>';
      return;
    }
    renderToc();
    const pos = readJSON(LS.pos, null);
    const idx = (pos && Number.isInteger(pos.i) && pos.i >= 0 && pos.i < state.toc.length) ? pos.i : 0;
    const restoreY = (pos && pos.i === idx) ? (pos.y || 0) : 0;
    await openChapter(idx, { keepScroll: true, y: restoreY });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
