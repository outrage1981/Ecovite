// Admin-only "Users" tab: add reps/admins and remove them. Any admin can
// create either role — there's no separate "super admin" tier.

import { getBackend } from './db.js';
import { escapeHtml } from './app.js';

export async function renderUsersView(root, profile) {
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  const backend = await getBackend();

  let users;
  try {
    users = await backend.listUsers();
  } catch (err) {
    root.innerHTML = `<div class="card empty-state">Could not load users: ${escapeHtml(err.message || String(err))}</div>`;
    return;
  }

  function render() {
    root.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h2>Add a user</h2>
        <p class="muted">Sets their starting password directly — there's no in-app way for them to change it yet, so share it with them however you normally would.</p>
        <div class="field-row">
          <label class="field"><span>Full name</span><input type="text" id="new-user-name" /></label>
          <label class="field"><span>Email</span><input type="email" id="new-user-email" /></label>
          <label class="field"><span>Password</span><input type="password" id="new-user-password" /></label>
          <label class="field">
            <span>Role</span>
            <select id="new-user-role">
              <option value="rep">Rep</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <button class="btn btn-primary" id="add-user-btn">Add user</button>
        <p class="form-error" id="add-user-error" hidden></p>
        <p class="faint" id="add-user-status"></p>
      </div>

      <div class="card">
        <h2>Existing users</h2>
        <div class="ing-list" id="users-list"></div>
      </div>
    `;

    const listEl = document.getElementById('users-list');
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'ing-row';
      row.style.cursor = 'default';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(u.full_name || u.email)}</strong>
          <div class="ing-meta">
            ${escapeHtml(u.email)} ·
            <span class="badge ${u.role === 'admin' ? 'badge-clay' : 'badge-neutral'}">${escapeHtml(u.role)}</span>
          </div>
        </div>
        ${u.id === profile.id ? '<span class="faint">(you)</span>' : '<button class="btn btn-danger btn-sm" data-role="delete-user">Remove</button>'}
      `;
      row.querySelector('[data-role="delete-user"]')?.addEventListener('click', async () => {
        if (!confirm(`Remove ${u.email}? This also permanently deletes any mixes they've saved.`)) return;
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

      const fullName = document.getElementById('new-user-name').value.trim();
      const email = document.getElementById('new-user-email').value.trim();
      const password = document.getElementById('new-user-password').value;
      const role = document.getElementById('new-user-role').value;

      if (!email || !password) {
        errorEl.textContent = 'Email and password are required.';
        errorEl.hidden = false;
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters.';
        errorEl.hidden = false;
        return;
      }

      statusEl.textContent = 'Adding…';
      try {
        const created = await backend.createUser({ email, password, fullName, role });
        users.push(created);
        statusEl.textContent = '';
        render();
      } catch (err) {
        statusEl.textContent = '';
        errorEl.textContent = err.message || 'Could not add user.';
        errorEl.hidden = false;
      }
    });
  }

  render();
}
