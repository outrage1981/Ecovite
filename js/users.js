// Admin-only "Users" tab: add, edit, set passwords for and remove reps and
// admins. Any admin can manage either role — there's no separate "super
// admin" tier — but nobody can change their own role, so an admin can't
// lock themselves out by accident.

import { getBackend } from './db.js';
import { escapeHtml } from './app.js';
import { passwordProblem, PASSWORD_HINT } from './passwordPolicy.js';

// Listed by display name ("Name Surname"), falling back to email.
const byDisplayName = (a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email);

export async function renderUsersView(root, profile) {
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  const backend = await getBackend();

  let users;
  try {
    users = (await backend.listUsers()).sort(byDisplayName);
  } catch (err) {
    root.innerHTML = `<div class="card empty-state">Could not load users: ${escapeHtml(err.message || String(err))}</div>`;
    return;
  }

  // Which row has a form open: { id, mode: 'edit' | 'password' } or null.
  let open = null;
  // One-line confirmation shown above the list after a save; cleared on the next action.
  let notice = '';

  function render() {
    root.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h2>Add a user</h2>
        <p class="muted">Sets their starting password directly, so share it with them however you normally would. You can set a new one later with "Set password" below.</p>
        <div class="field-row">
          <label class="field"><span>Name</span><input type="text" id="new-user-name" autocomplete="off" /></label>
          <label class="field"><span>Surname</span><input type="text" id="new-user-surname" autocomplete="off" /></label>
          <label class="field"><span>Email</span><input type="email" id="new-user-email" autocomplete="off" /></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Password</span><input type="password" id="new-user-password" autocomplete="new-password" /></label>
          <label class="field">
            <span>Role</span>
            <select id="new-user-role">
              <option value="rep">Rep</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <p class="faint">${escapeHtml(PASSWORD_HINT)}</p>
        <button class="btn btn-primary" id="add-user-btn">Add user</button>
        <p class="form-error" id="add-user-error" hidden></p>
        <p class="faint" id="add-user-status"></p>
      </div>

      <div class="card">
        <h2>Existing users</h2>
        ${notice ? `<p class="muted" id="users-notice">${escapeHtml(notice)}</p>` : ''}
        <div class="ing-list" id="users-list"></div>
      </div>
    `;

    const listEl = document.getElementById('users-list');
    users.forEach((u) => {
      const isSelf = u.id === profile.id;
      const formMode = open?.id === u.id ? open.mode : null;
      const row = document.createElement('div');
      row.className = 'ing-row';
      row.style.cursor = 'default';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(u.full_name || u.email)}</strong>
          <div class="ing-meta">
            ${escapeHtml(u.email)} ·
            <span class="badge ${u.role === 'admin' ? 'badge-clay' : 'badge-neutral'}">${escapeHtml(u.role)}</span>
            ${isSelf ? '<span class="faint">(you)</span>' : ''}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" data-role="edit-user">Edit</button>
          <button class="btn btn-secondary btn-sm" data-role="password-user">Set password</button>
          ${isSelf ? '' : '<button class="btn btn-danger btn-sm" data-role="delete-user">Remove</button>'}
        </div>
        ${formMode ? `<div style="flex-basis:100%;">${formMode === 'edit' ? editFormHtml(u, isSelf) : passwordFormHtml(u)}</div>` : ''}
      `;

      const toggle = (mode) => {
        open = formMode === mode ? null : { id: u.id, mode };
        notice = '';
        render();
      };
      row.querySelector('[data-role="edit-user"]').addEventListener('click', () => toggle('edit'));
      row.querySelector('[data-role="password-user"]').addEventListener('click', () => toggle('password'));
      row.querySelector('[data-role="cancel"]')?.addEventListener('click', () => { open = null; render(); });
      row.querySelector('[data-role="save-edit"]')?.addEventListener('click', () => saveEdit(row, u, isSelf));
      row.querySelector('[data-role="save-password"]')?.addEventListener('click', () => savePassword(row, u, isSelf));

      row.querySelector('[data-role="delete-user"]')?.addEventListener('click', async () => {
        if (!confirm(`Remove ${u.full_name || u.email}? This also permanently deletes any mixes they've saved.`)) return;
        try {
          await backend.deleteUser(u.id);
          users = users.filter((x) => x.id !== u.id);
          render();
        } catch (err) {
          alert(err.message || 'Could not remove user.');
        }
      });
      listEl.appendChild(row);
    });

    document.getElementById('add-user-btn').addEventListener('click', async () => {
      const errorEl = document.getElementById('add-user-error');
      const statusEl = document.getElementById('add-user-status');
      errorEl.hidden = true;

      const name = document.getElementById('new-user-name').value.trim();
      const surname = document.getElementById('new-user-surname').value.trim();
      const email = document.getElementById('new-user-email').value.trim();
      const password = document.getElementById('new-user-password').value;
      const role = document.getElementById('new-user-role').value;

      const problem = !name || !surname || !email
        ? 'Name, surname and email are required.'
        : passwordProblem(password);
      if (problem) {
        errorEl.textContent = problem;
        errorEl.hidden = false;
        return;
      }

      statusEl.textContent = 'Adding…';
      try {
        const created = await backend.createUser({ name, surname, email, password, role });
        users = [...users, created].sort(byDisplayName);
        statusEl.textContent = '';
        render();
      } catch (err) {
        statusEl.textContent = '';
        errorEl.textContent = err.message || 'Could not add user.';
        errorEl.hidden = false;
      }
    });
  }

  function editFormHtml(u, isSelf) {
    const roleOption = (value, label) => `<option value="${value}" ${u.role === value ? 'selected' : ''}>${label}</option>`;
    return `
      <div class="field-row" style="margin-top:10px;">
        <label class="field"><span>Name</span><input type="text" data-field="name" value="${escapeHtml(u.name || '')}" /></label>
        <label class="field"><span>Surname</span><input type="text" data-field="surname" value="${escapeHtml(u.surname || '')}" /></label>
        <label class="field"><span>Email</span><input type="email" data-field="email" value="${escapeHtml(u.email)}" /></label>
        <label class="field">
          <span>Role</span>
          <select data-field="role" ${isSelf ? 'disabled title="You can\'t change your own role."' : ''}>
            ${roleOption('rep', 'Rep')}${roleOption('admin', 'Admin')}
          </select>
        </label>
      </div>
      ${isSelf ? '<p class="faint">You can\'t change your own role — ask another admin.</p>' : ''}
      <button class="btn btn-primary btn-sm" data-role="save-edit">Save</button>
      <button class="btn btn-secondary btn-sm" data-role="cancel">Cancel</button>
      <p class="form-error" data-field="error" hidden></p>
    `;
  }

  function passwordFormHtml(u) {
    return `
      <div class="field-row" style="margin-top:10px;">
        <label class="field"><span>New password for ${escapeHtml(u.full_name || u.email)}</span><input type="password" data-field="password" autocomplete="new-password" /></label>
        <label class="field"><span>Repeat new password</span><input type="password" data-field="confirm" autocomplete="new-password" /></label>
      </div>
      <p class="faint">${escapeHtml(PASSWORD_HINT)} They'll be signed out on their other devices and must sign in with the new password.</p>
      <button class="btn btn-primary btn-sm" data-role="save-password">Set password</button>
      <button class="btn btn-secondary btn-sm" data-role="cancel">Cancel</button>
      <p class="form-error" data-field="error" hidden></p>
    `;
  }

  const showRowError = (row, message) => {
    const el = row.querySelector('[data-field="error"]');
    el.textContent = message;
    el.hidden = false;
  };

  async function saveEdit(row, u, isSelf) {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const surname = row.querySelector('[data-field="surname"]').value.trim();
    const email = row.querySelector('[data-field="email"]').value.trim();
    const role = isSelf ? u.role : row.querySelector('[data-field="role"]').value;
    if (!name || !surname || !email) return showRowError(row, 'Name, surname and email are required.');
    try {
      const updated = await backend.updateUser(u.id, { name, surname, email, role });
      users = users.map((x) => (x.id === u.id ? updated : x)).sort(byDisplayName);
      open = null;
      notice = `Saved changes to ${updated.full_name || updated.email}.`;
      render();
    } catch (err) {
      showRowError(row, err.message || 'Could not save changes.');
    }
  }

  async function savePassword(row, u, isSelf) {
    const password = row.querySelector('[data-field="password"]').value;
    const confirmPassword = row.querySelector('[data-field="confirm"]').value;
    const problem = passwordProblem(password);
    if (problem) return showRowError(row, problem);
    if (password !== confirmPassword) return showRowError(row, 'The two passwords don\'t match.');
    try {
      await backend.setUserPassword(u.id, password);
      open = null;
      notice = isSelf
        ? 'Your password has been changed.'
        : `Password set for ${u.full_name || u.email}. Share it with them however you normally would.`;
      render();
    } catch (err) {
      showRowError(row, err.message || 'Could not set the password.');
    }
  }

  render();
}
