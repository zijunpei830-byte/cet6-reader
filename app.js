/* 全球高考 / 穿堂惊掠琵琶声 / 破云 · 六级词汇阅读器 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LS = {
    vocab: 'gqg.vocab.v2',
    notes: 'gqg.notes.v2',
    pos: 'gqg.pos.v2',
    read: 'gqg.read.v2',
    ui: 'gqg.ui.v2',
    book: 'gqg.book.v2',
    old: ['gqg.vocab.v1', 'gqg.notes.v1', 'gqg.read.v1', 'gqg.ui.v1'],
  };

  const state = {
    books: [],
    book: null,            // 当前书 id
    toc: [],               // 当前书章节
    idx: 0,
    chapter: null,
    words: {},
    vocab: {},             // word -> 收藏时间戳
    notes: {},             // word -> 手写笔记
    pos: { last: null, byBook: {} },
    read: {},              // bookId -> [章节号]
    ui: { fs: 19, theme: 'light' },
    view: 'shelf',
  };
  const cache = new Map();
  let cardWord = null;
  let noteTimer = 0;

  /* ---------------- 存储 ---------------- */
  const readJSON = (k, d) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; }
    catch { return d; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function loadStores() {
    state.vocab = readJSON(LS.vocab, null) || readJSON(LS.old[0], {}) || {};
    state.notes = readJSON(LS.notes, null) || readJSON(LS.old[1], {}) || {};
    state.pos = readJSON(LS.pos, null) || { last: null, byBook: {} };
    const r = readJSON(LS.read, null);
    state.read = (r && !Array.isArray(r)) ? r : {};
    const ui = readJSON(LS.ui, null) || readJSON(LS.old[3], null);
    if (ui) state.ui = Object.assign(state.ui, ui);
  }
  const saveVocab = () => writeJSON(LS.vocab, state.vocab);
  const saveUi = () => writeJSON(LS.ui, state.ui);
  const saveRead = () => writeJSON(LS.read, state.read);
  const savePos = () => {
    if (!state.book || !state.chapter) return;
    state.pos.last = state.book;
    state.pos.byBook = state.pos.byBook || {};
    state.pos.byBook[state.book] = { i: state.idx, y: Math.round(window.scrollY) };
    writeJSON(LS.pos, state.pos);
  };

  const bookMeta = () => state.books.find((b) => b.id === state.book) || null;

  /* ---------------- 主题 / 字号 ---------------- */
  function applyTheme() {
    document.documentElement.dataset.theme = state.ui.theme;
    $('themeSwitch').setAttribute('aria-checked', String(state.ui.theme === 'dark'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = state.ui.theme === 'dark' ? '#15181d' : '#f7f5f0';
  }
  function applyFont() {
    document.documentElement.style.setProperty('--fs', state.ui.fs + 'px');
  }

  /* ---------------- 视图 ---------------- */
  function showView(view) {
    state.view = view;
    $('viewShelf').hidden = view !== 'shelf';
    $('viewReader').hidden = view !== 'reader';
    $('viewVocab').hidden = view !== 'vocab';
    $('btnToc').style.visibility = view === 'reader' ? 'visible' : 'hidden';
    $('btnBook').textContent = view === 'reader' && bookMeta() ? bookMeta().title : '书架';
    if (view === 'vocab') {
      $('vocabIcon').textContent = '←';
      $('vocabLabel').textContent = '返回';
      $('vocabBadge').hidden = true;
      renderVocab();
      window.scrollTo(0, 0);
    } else {
      $('vocabIcon').textContent = '📖';
      $('vocabLabel').textContent = '生词本';
      updateVocabBadge();
    }
    if (view === 'shelf') {
      renderShelf();
      window.scrollTo(0, 0);
    }
    if (view === 'reader') {
      const p = (state.pos.byBook || {})[state.book];
      requestAnimationFrame(() => window.scrollTo(0, p ? p.y || 0 : 0));
    }
  }

  /* ---------------- 书架 ---------------- */
  function renderShelf() {
    const list = $('bookList');
    list.innerHTML = state.books.map((b) => {
      const wan = (b.chars / 10000).toFixed(1);
      const readN = (state.read[b.id] || []).length;
      return `<li><button class="bookcard" type="button" data-book="${b.id}">
        <div class="bt">${escapeHtml(b.title)}</div>
        <div class="ba">${escapeHtml(b.author || '')}</div>
        <div class="bm"><span>${b.chapters.length} 章</span><span>${wan} 万字</span>
        <span>${b.ann} 处词汇</span>${readN ? `<span>已读 ${readN} 章</span>` : ''}</div>
      </button></li>`;
    }).join('');
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
        const hit = c.t.toLowerCase().includes(q.toLowerCase()) || String(i + 1) === q;
        if (!hit) return;
      }
      const isRead = (state.read[state.book] || []).includes(c.i);
      rows.push(`<div class="tocrow${i === state.idx ? ' active' : ''}${isRead ? ' read' : ''}" data-i="${i}">` +
        `<span class="t">${escapeHtml(c.t)}</span><span class="n">${c.n}词</span></div>`);
    });
    list.innerHTML = rows.length ? rows.join('') : '<div class="vempty" style="padding:36px 8px">没有找到这一章</div>';
  }

  /* ---------------- 章节 ---------------- */
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function fetchChapter(i) {
    const key = state.book + '/' + i;
    if (cache.has(key)) return cache.get(key);
    const r = await fetch(`data/${state.book}/ch/${String(i).padStart(3, '0')}.json`, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    cache.set(key, d);
    return d;
  }

  function splitTitle(t) {
    const m = /^(第[0-9０-９一二三四五六七八九十百零两]+章)\s*(.*)$/.exec(t);
    if (!m) return { no: '', name: t };
    if (!m[2]) return { no: '', name: m[1] };
    return { no: m[1], name: m[2] };
  }

  async function openBook(id, resume) {
    if (!state.books.some((b) => b.id === id)) return;
    savePos();
    const meta = state.books.find((b) => b.id === id);
    state.book = id;
    state.toc = meta.chapters;
    writeJSON(LS.book, id);
    renderToc('');
    const p = resume && state.pos.byBook && state.pos.byBook[id] ? state.pos.byBook[id] : null;
    const idx = p && Number.isInteger(p.i) && p.i >= 0 && p.i < state.toc.length ? p.i : 0;
    showView('reader');
    await openChapter(idx, { keepScroll: true, y: p ? p.y || 0 : 0 });
  }

  async function openChapter(i, opts = {}) {
    if (!state.book || i < 0 || i >= state.toc.length) return;
    const meta = state.toc[i];
    state.idx = i;
    const page = $('page');
    page.innerHTML = '<div class="loading">正在翻开书页…</div>';
    let data;
    try {
      data = await fetchChapter(meta.i);
    } catch (e) {
      page.innerHTML = '<div class="loading">这一章没加载出来。刷新或点目录重试一下。</div>';
      return;
    }
    state.chapter = data;
    const { no, name } = splitTitle(data.t);
    const body = data.p.map((p) => `<p${p.startsWith('【') ? ' class="sys"' : ''}>${p}</p>`).join('');
    page.innerHTML = (no ? `<div class="chaphead"><div class="chapno">${escapeHtml(no)}</div>` +
      `<h1 class="chaptitle">${escapeHtml(name)}</h1></div>`
      : `<div class="chaphead"><h1 class="chaptitle">${escapeHtml(name)}</h1></div>`) + body;

    markSavedWords();
    renderChapterNav(i);
    markRead(i);
    if (!opts.keepScroll) window.scrollTo(0, 0);
    else if (opts.y) requestAnimationFrame(() => window.scrollTo(0, opts.y));
    savePos();
    updateProgressBar();
    if (i + 1 < state.toc.length) fetchChapter(state.toc[i + 1].i).catch(() => {});
  }

  const shortTitle = (t) => {
    const { no, name } = splitTitle(t);
    return (no + ' ' + name).trim().slice(0, 14);
  };

  function renderChapterNav(i) {
    const prev = state.toc[i - 1], next = state.toc[i + 1];
    $('chapternav').innerHTML =
      `<button type="button" data-step="-1" ${prev ? '' : 'disabled'}>← ${prev ? escapeHtml(shortTitle(prev.t)) : '已是第一章'}</button>` +
      `<button type="button" data-step="1" class="next" ${next ? '' : 'disabled'}>${next ? escapeHtml(shortTitle(next.t)) : '全书完'} →</button>`;
  }

  function markRead(i) {
    const id = state.book;
    state.read[id] = state.read[id] || [];
    if (!state.read[id].includes(state.toc[i].i)) {
      state.read[id].push(state.toc[i].i);
      saveRead();
    }
    document.querySelectorAll('.tocrow').forEach((r) => {
      const on = Number(r.dataset.i) === i;
      r.classList.toggle('active', on);
      if (on) r.classList.add('read');
    });
  }

  /* ---------------- 进度条 ---------------- */
  function updateProgressBar() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const p = h > 60 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
    $('progressbar').style.width = (p * 100).toFixed(2) + '%';
  }
  let scrollTimer = 0;
  window.addEventListener('scroll', () => {
    updateProgressBar();
    if (state.view !== 'reader' || !state.chapter) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(savePos, 350);
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
    const names = Object.keys(w.books || {}).map((id) => (state.books.find((b) => b.id === id) || {}).title).filter(Boolean);
    $('wcBooks').textContent = names.length ? '见：' + names.join(' · ') : '';
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
    const keys = Object.keys(state.vocab).sort((a, b) => state.vocab[b] - state.vocab[a]);
    $('vocabSub').textContent = keys.length
      ? `收集了 ${keys.length} 个词，三本书共用。点单词可以补笔记。`
      : '点正文里的英文单词，卡片里可以收藏、写笔记。';
    if (!keys.length) {
      list.innerHTML = '<li class="vempty"><b>生词本还是空的</b>读到不熟的词，点正文里的英文，<br>卡片下方点「收藏」就会留在这里。</li>';
      return;
    }
    list.innerHTML = keys.map((k) => {
      const w = state.words[k] || { w: k, ipa: '', pos: '', zh: '', colloc: [] };
      const note = state.notes[k];
      const names = Object.keys(w.books || {}).map((id) => (state.books.find((b) => b.id === id) || {}).title).filter(Boolean);
      return `<li class="vitem">
        <div class="vmain">
          <div class="vword" data-word="${escapeHtml(w.w)}">${escapeHtml(w.w)}<span class="vipa">${escapeHtml(w.ipa || '')}</span></div>
          <div class="vmean">${w.pos ? `<span class="wc-pos" style="margin-right:6px">${escapeHtml(w.pos)}</span>` : ''}${escapeHtml(w.zh || '')}</div>
          ${note ? `<div class="vnote">${escapeHtml(note)}</div>` : ''}
          ${names.length ? `<div class="vbooks">见：${escapeHtml(names.join(' · '))}</div>` : ''}
        </div>
        <button class="vdel" type="button" data-del="${escapeHtml(w.w)}">删除</button>
      </li>`;
    }).join('');
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
    $('btnBook').addEventListener('click', () => {
      if (state.view !== 'shelf') { savePos(); flushNote(); closeCard(); showView('shelf'); }
    });
    $('btnVocab').addEventListener('click', () => {
      if (state.view === 'vocab') { closeCard(); showView('reader'); }
      else { savePos(); showView('vocab'); }
    });

    $('bookList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]');
      if (!b) return;
      openBook(b.dataset.book, true);
    });

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
        applyFont(); saveUi();
      });
    });
    $('themeSwitch').addEventListener('click', () => {
      state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
      applyTheme(); saveUi();
    });

    $('page').addEventListener('click', (e) => {
      const el = e.target.closest('.w');
      if (el) { openCard(el.dataset.w); return; }
      if (!$('wordcard').hidden) closeCard();
    });
    $('vocabList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        delete state.vocab[del.dataset.del];
        saveVocab(); markSavedWords(); updateVocabBadge(); renderVocab();
        return;
      }
      const w = e.target.closest('[data-word]');
      if (w) openCard(w.dataset.word);
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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('wordcard').hidden) return closeCard();
        if ($('tocDrawer').classList.contains('on')) return openToc(false);
      }
      if (state.view !== 'reader' || !$('wordcard').hidden) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') openChapter(state.idx + 1);
      if (e.key === 'ArrowLeft') openChapter(state.idx - 1);
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    loadStores();
    applyTheme();
    applyFont();
    bind();
    try {
      const [books, words] = await Promise.all([
        fetch('books.json', { cache: 'force-cache' }).then((r) => r.json()),
        fetch('words.json', { cache: 'force-cache' }).then((r) => r.json()),
      ]);
      state.books = books.books || [];
      state.words = words;
    } catch (err) {
      $('page').innerHTML = '<div class="loading">书目没读到。刷新一下页面。</div>';
      showView('reader');
      return;
    }
    const lastBook = readJSON(LS.book, null) || (state.pos && state.pos.last);
    if (lastBook && state.books.some((b) => b.id === lastBook)) {
      await openBook(lastBook, true);
    } else {
      showView('shelf');
    }
    updateVocabBadge();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
