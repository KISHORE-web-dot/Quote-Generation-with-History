/**
 * QuoteVault — app.js
 *
 * Responsibilities:
 *  1. POST-style trigger → GET /api/quote  (backend fetches external API + saves to DB)
 *  2. Load & render quote history from GET /api/history
 *  3. Toggle favourites via PATCH /api/history/:id/favorite
 *  4. Delete single quote via DELETE /api/history/:id
 *  5. Clear all history via DELETE /api/history
 *  6. Refresh stats via GET /api/stats
 */

const API = 'http://127.0.0.1:8001';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const btnNewQuote    = document.getElementById('btnNewQuote');
const btnFavorite    = document.getElementById('btnFavorite');
const btnCopy        = document.getElementById('btnCopy');
const btnShare       = document.getElementById('btnShare');
const btnClearHistory = document.getElementById('btnClearHistory');

const quoteIdle      = document.getElementById('quoteIdle');
const quoteDisplay   = document.getElementById('quoteDisplay');
const quoteLoading   = document.getElementById('quoteLoading');
const quoteText      = document.getElementById('quoteText');
const quoteAuthor    = document.getElementById('quoteAuthor');
const quoteSourceBadge = document.getElementById('quoteSourceBadge');

const historyList    = document.getElementById('historyList');
const historyEmpty   = document.getElementById('historyEmpty');

const numTotal       = document.getElementById('numTotal');
const numFavs        = document.getElementById('numFavs');
const numZen         = document.getElementById('numZen');

const toastEl        = document.getElementById('toast');
const filterTabs     = document.querySelectorAll('.filter-tab');

// ── State ─────────────────────────────────────────────────────────────────────
let currentQuote  = null;   // the quote object currently on display
let activeFilter  = 'all';  // 'all' | 'favorites'
let toastTimer    = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  loadStats();
  setupListeners();
});

// ── Event listeners ───────────────────────────────────────────────────────────
function setupListeners() {
  btnNewQuote.addEventListener('click', fetchNewQuote);
  btnFavorite.addEventListener('click', toggleCurrentFavorite);
  btnCopy.addEventListener('click', copyCurrentQuote);
  btnShare.addEventListener('click', shareCurrentQuote);
  btnClearHistory.addEventListener('click', clearAllHistory);

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      activeFilter = tab.dataset.filter;
      loadHistory();
    });
  });
}

// ── Fetch a new quote ─────────────────────────────────────────────────────────
async function fetchNewQuote() {
  showLoading(true);
  btnNewQuote.disabled = true;

  try {
    /**
     * GET /api/quote
     * The backend calls the external ZenQuotes API, saves the quote to SQLite,
     * and returns the saved record — so we get an ID we can act on immediately.
     */
    const res = await fetch(`${API}/api/quote`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const quote = await res.json();

    currentQuote = quote;
    renderCurrentQuote(quote);
    prependToHistory(quote);
    loadStats();
    showToast('New quote fetched & saved ✦', 'success');

  } catch (err) {
    showLoading(false);
    showIdle();
    if (err.name === 'TypeError') {
      showToast('Cannot reach backend. Is it running on port 8001?', 'error');
    } else {
      showToast(`Error: ${err.message}`, 'error');
    }
  } finally {
    btnNewQuote.disabled = false;
  }
}

// ── Render the hero quote card ────────────────────────────────────────────────
function renderCurrentQuote(quote) {
  quoteText.textContent   = quote.text;
  quoteAuthor.textContent = quote.author;
  quoteSourceBadge.textContent = quote.source;

  showLoading(false);
  quoteIdle.hidden    = true;
  quoteDisplay.hidden = false;

  // Sync favorite button state
  syncFavoriteBtn(quote.is_favorite);

  btnFavorite.disabled = false;
  btnCopy.disabled     = false;
  btnShare.disabled    = false;
}

function showLoading(on) {
  quoteLoading.hidden = !on;
  if (on) {
    quoteIdle.hidden    = true;
    quoteDisplay.hidden = true;
  }
}

function showIdle() {
  quoteIdle.hidden    = false;
  quoteDisplay.hidden = true;
  quoteLoading.hidden = true;
}

function syncFavoriteBtn(isFav) {
  if (isFav) {
    btnFavorite.classList.add('favorited');
    btnFavorite.title = 'Remove from favourites';
  } else {
    btnFavorite.classList.remove('favorited');
    btnFavorite.title = 'Add to favourites';
  }
}

// ── Toggle favourite for current quote ───────────────────────────────────────
async function toggleCurrentFavorite() {
  if (!currentQuote) return;
  const newFav = !currentQuote.is_favorite;

  try {
    const res = await fetch(`${API}/api/history/${currentQuote.id}/favorite`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorite: newFav }),
    });
    if (!res.ok) throw new Error('Failed to update favourite');
    const updated = await res.json();
    currentQuote = updated;
    syncFavoriteBtn(updated.is_favorite);

    // Sync the history card too
    updateHistoryItemFavState(updated.id, updated.is_favorite);
    loadStats();
    showToast(updated.is_favorite ? '❤ Added to favourites' : 'Removed from favourites', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ── Copy quote to clipboard ───────────────────────────────────────────────────
async function copyCurrentQuote() {
  if (!currentQuote) return;
  const text = `"${currentQuote.text}" — ${currentQuote.author}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success');
  } catch (_) {
    showToast('Copy failed. Please copy manually.', 'error');
  }
}

// ── Share via Web Share API (falls back to copy) ──────────────────────────────
async function shareCurrentQuote() {
  if (!currentQuote) return;
  const shareData = {
    title: 'QuoteVault',
    text:  `"${currentQuote.text}" — ${currentQuote.author}`,
    url:   window.location.href,
  };
  if (navigator.share) {
    try { await navigator.share(shareData); }
    catch (_) { /* user cancelled */ }
  } else {
    await copyCurrentQuote();
  }
}

// ── Load history ──────────────────────────────────────────────────────────────
async function loadHistory() {
  const favsOnly = activeFilter === 'favorites';
  const url = `${API}/api/history${favsOnly ? '?favorites_only=true' : ''}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const quotes = await res.json();
    renderHistory(quotes);
  } catch (_) {
    // Backend not yet reachable on first load; show empty
    renderHistory([]);
  }
}

function renderHistory(quotes) {
  historyList.innerHTML = '';

  if (quotes.length === 0) {
    historyEmpty.hidden = false;
    return;
  }

  historyEmpty.hidden = true;
  quotes.forEach((q, idx) => {
    historyList.appendChild(buildHistoryItem(q, quotes.length - idx));
  });
}

// ── Build a single history list item ─────────────────────────────────────────
function buildHistoryItem(quote, num) {
  const li = document.createElement('li');
  li.className = `history-item${quote.is_favorite ? ' is-favorite' : ''}`;
  li.dataset.id = quote.id;

  const date = new Date(quote.fetched_at);
  const dateStr = date.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  li.innerHTML = `
    <span class="item-num">#${num}</span>
    <div class="item-body">
      <p class="item-quote">${escHtml(quote.text)}</p>
      <div class="item-meta">
        <span class="item-author">— ${escHtml(quote.author)}</span>
        <span class="item-date">${dateStr}</span>
        <span class="item-source">${escHtml(quote.source)}</span>
      </div>
    </div>
    <div class="item-actions">
      <button class="item-btn fav-btn${quote.is_favorite ? ' active' : ''}"
              title="${quote.is_favorite ? 'Unfavourite' : 'Favourite'}"
              aria-label="${quote.is_favorite ? 'Remove from favourites' : 'Add to favourites'}"
              data-id="${quote.id}"
              data-fav="${quote.is_favorite}">
        ${quote.is_favorite ? '❤' : '♡'}
      </button>
      <button class="item-btn del-btn"
              title="Delete"
              aria-label="Delete quote"
              data-id="${quote.id}">
        ✕
      </button>
    </div>`;

  // Fav button
  li.querySelector('.fav-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleHistoryFavorite(quote.id, li);
  });

  // Delete button
  li.querySelector('.del-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteHistoryItem(quote.id, li);
  });

  return li;
}

// ── Toggle favourite from history list ───────────────────────────────────────
async function toggleHistoryFavorite(id, li) {
  const btn    = li.querySelector('.fav-btn');
  const curFav = btn.dataset.fav === 'true';
  const newFav = !curFav;

  try {
    const res = await fetch(`${API}/api/history/${id}/favorite`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorite: newFav }),
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();

    btn.dataset.fav  = updated.is_favorite;
    btn.textContent  = updated.is_favorite ? '❤' : '♡';
    btn.title        = updated.is_favorite ? 'Unfavourite' : 'Favourite';
    btn.classList.toggle('active', updated.is_favorite);
    li.classList.toggle('is-favorite', updated.is_favorite);

    // Sync hero button if same quote
    if (currentQuote && currentQuote.id === id) {
      currentQuote.is_favorite = updated.is_favorite;
      syncFavoriteBtn(updated.is_favorite);
    }

    loadStats();
    if (activeFilter === 'favorites') loadHistory();
    showToast(updated.is_favorite ? '❤ Favourited' : 'Removed', 'success');
  } catch (_) {
    showToast('Failed to update.', 'error');
  }
}

// ── Delete from history ───────────────────────────────────────────────────────
async function deleteHistoryItem(id, li) {
  try {
    const res = await fetch(`${API}/api/history/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error();

    li.classList.add('removing');
    setTimeout(() => {
      li.remove();
      if (historyList.children.length === 0) historyEmpty.hidden = false;
      loadStats();
    }, 320);

    if (currentQuote && currentQuote.id === id) {
      currentQuote = null;
      showIdle();
      btnFavorite.disabled = true;
      btnCopy.disabled     = true;
      btnShare.disabled    = true;
    }

    showToast('Quote deleted.', 'warning');
  } catch (_) {
    showToast('Failed to delete.', 'error');
  }
}

// ── Update favourite state in history list without re-fetch ──────────────────
function updateHistoryItemFavState(id, isFav) {
  const li  = historyList.querySelector(`[data-id="${id}"]`);
  if (!li) return;
  const btn = li.querySelector('.fav-btn');
  if (btn) {
    btn.dataset.fav = isFav;
    btn.textContent = isFav ? '❤' : '♡';
    btn.classList.toggle('active', isFav);
  }
  li.classList.toggle('is-favorite', isFav);
}

// ── Prepend newest quote to history list ─────────────────────────────────────
function prependToHistory(quote) {
  historyEmpty.hidden = true;
  const totalItems = historyList.children.length + 1;
  const li = buildHistoryItem(quote, totalItems);
  historyList.insertBefore(li, historyList.firstChild);

  // Re-number all items
  renumberItems();
}

function renumberItems() {
  const items = historyList.querySelectorAll('.history-item');
  const total = items.length;
  items.forEach((item, i) => {
    const numEl = item.querySelector('.item-num');
    if (numEl) numEl.textContent = `#${total - i}`;
  });
}

// ── Clear all history ─────────────────────────────────────────────────────────
async function clearAllHistory() {
  if (!confirm('Clear entire quote history? This cannot be undone.')) return;

  try {
    const res = await fetch(`${API}/api/history`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error();

    historyList.innerHTML = '';
    historyEmpty.hidden   = false;
    currentQuote = null;
    showIdle();
    btnFavorite.disabled = true;
    btnCopy.disabled     = true;
    btnShare.disabled    = true;
    loadStats();
    showToast('History cleared.', 'warning');
  } catch (_) {
    showToast('Failed to clear history.', 'error');
  }
}

// ── Load stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    if (!res.ok) return;
    const s = await res.json();
    numTotal.textContent = s.total_quotes;
    numFavs.textContent  = s.favorites;
    numZen.textContent   = s.from_zenquotes;
  } catch (_) {
    // Silent
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 3500);
}

// ── XSS helper ───────────────────────────────────────────────────────────────
function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
