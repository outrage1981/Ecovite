import { getBackend, resetDemoData } from './db.js';
import { IS_CONFIGURED } from './config.js';
import { renderRepView, resetRepViewState } from './rep.js';
import { renderAdminIngredients, renderAdminSettings } from './admin.js';
import { renderHistoryView } from './history.js';
import { renderUsersView } from './users.js';

const appEl = document.getElementById('app');

let profile = null;
let activeTab = 'compare';

async function boot() {
  const backend = await getBackend();
  // The "reset your password" email links back here with a one-time token
  // in the URL hash (see the email template in pb_migrations/). Show the
  // "set a new password" screen instead of the normal app.
  const resetMatch = location.hash.match(/reset-password=([^&]+)/);
  if (resetMatch) {
    renderResetPassword(decodeURIComponent(resetMatch[1]));
    return;
  }
  profile = await backend.getProfile();
  if (!profile) {
    renderLogin();
  } else {
    renderShell();
  }
}

function renderLogin({ notice } = {}) {
  const tpl = document.getElementById('tpl-login');
  appEl.innerHTML = '';
  appEl.appendChild(tpl.content.cloneNode(true));

  if (notice) {
    const hint = document.getElementById('demo-hint');
    hint.hidden = false;
    hint.textContent = notice;
  }

  if (!IS_CONFIGURED) {
    const hint = document.getElementById('demo-hint');
    hint.hidden = false;
    hint.innerHTML =
      'Running in demo mode — nothing here reaches the server.<br>' +
      'Try it as <strong>admin@demo.local</strong> / <strong>admin123</strong><br>' +
      'or <strong>rep@demo.local</strong> / <strong>rep123</strong>.<br>' +
      'Seeing stale or missing data (e.g. no ingredient prices)? ' +
      '<a href="#" id="reset-demo-link">Reset demo data</a>.';
    document.getElementById('reset-demo-link').addEventListener('click', (e) => {
      e.preventDefault();
      resetDemoData();
      location.reload();
    });
  }

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    try {
      const data = new FormData(form);
      const backend = await getBackend();
      await backend.signIn(data.get('email'), data.get('password'));
      profile = await backend.getProfile();
      renderShell();
    } catch (err) {
      errorEl.textContent = err.message || 'Could not sign in.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });

  document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    renderForgotPassword();
  });
}

function renderForgotPassword() {
  const tpl = document.getElementById('tpl-forgot-password');
  appEl.innerHTML = '';
  appEl.appendChild(tpl.content.cloneNode(true));

  const form = document.getElementById('forgot-password-form');
  const errorEl = document.getElementById('forgot-password-error');
  const successEl = document.getElementById('forgot-password-success');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      const data = new FormData(form);
      const backend = await getBackend();
      await backend.requestPasswordReset(data.get('email'));
      form.reset();
      successEl.textContent = 'If an account exists for that email, a reset link is on its way — check your inbox.';
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = err.message || 'Could not send reset link.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send reset link';
    }
  });

  document.getElementById('back-to-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    renderLogin();
  });
}

function renderResetPassword(token) {
  const tpl = document.getElementById('tpl-reset-password');
  appEl.innerHTML = '';
  appEl.appendChild(tpl.content.cloneNode(true));

  const form = document.getElementById('reset-password-form');
  const errorEl = document.getElementById('reset-password-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const data = new FormData(form);
    const password = data.get('password');
    if (password !== data.get('confirmPassword')) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.hidden = false;
      return;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      const backend = await getBackend();
      await backend.confirmPasswordReset(token, password);
      // Drop the token from the URL so refreshing the page doesn't
      // re-trigger this screen once the password is already set.
      history.replaceState(null, '', location.pathname + location.search);
      renderLogin({ notice: 'Password updated — sign in with your new password.' });
    } catch (err) {
      errorEl.textContent = err.message || 'Could not set new password.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Set new password';
    }
  });
}

function renderShell() {
  const isAdmin = profile.role === 'admin';
  appEl.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">EV</div>
        <h1>EcoVite Lick Comparison</h1>
      </div>
      <div class="user-chip">
        <span class="user-name">${escapeHtml(profile.full_name || profile.email)}</span>
        <span class="role-badge">${isAdmin ? 'Admin' : 'Rep'}</span>
        <button class="btn btn-ghost btn-sm" id="logout-btn">Sign out</button>
      </div>
    </div>
    <nav class="tabs" id="tabs">
      <button class="tab-btn" data-tab="compare">Compare Licks</button>
      <button class="tab-btn" data-tab="history">History</button>
      ${isAdmin ? '<button class="tab-btn" data-tab="ingredients">Ingredients</button>' : ''}
      ${isAdmin ? '<button class="tab-btn" data-tab="settings">Settings</button>' : ''}
      ${isAdmin ? '<button class="tab-btn" data-tab="users">Users</button>' : ''}
    </nav>
    <main class="view" id="view"></main>
  `;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    const backend = await getBackend();
    await backend.signOut();
    resetRepViewState();
    profile = null;
    activeTab = 'compare';
    renderLogin();
  });

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    renderTabs();
    renderActiveView();
  });

  renderTabs();
  renderActiveView();
}

function renderTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
}

function renderActiveView() {
  const viewEl = document.getElementById('view');
  viewEl.innerHTML = '';
  if (activeTab === 'compare') renderRepView(viewEl, profile);
  else if (activeTab === 'history') renderHistoryView(viewEl, profile);
  else if (activeTab === 'ingredients') renderAdminIngredients(viewEl);
  else if (activeTab === 'settings') renderAdminSettings(viewEl);
  else if (activeTab === 'users') renderUsersView(viewEl, profile);
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmt(num, digits = 2) {
  if (num == null || Number.isNaN(num)) return '—';
  return num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

boot();
