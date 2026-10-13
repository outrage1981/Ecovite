// "Install app" button for the login screen.
//
// Chrome/Edge (desktop + Android) fire `beforeinstallprompt` once the app
// is installable; we hold on to that event and replay it when the button
// is tapped, which opens the browser's own install dialog. iOS Safari has
// no install API at all, so there we show the manual Share → Add to Home
// Screen instruction instead. Other browsers (Firefox, desktop Safari)
// get nothing, and nothing is shown once the app is already installed.
//
// The listeners are attached as soon as this module loads (app.js imports
// it), because the event can fire before the login screen is rendered.

let deferredPrompt = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep the browser's own mini-infobar from popping up
  deferredPrompt = e;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installed = true;
  notify();
});

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iPadOS reports itself as a Mac, so also check for a touch screen.
const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function mountInstallButton(slot) {
  function render() {
    if (!slot.isConnected) {
      listeners.delete(render); // login screen was replaced
      return;
    }
    slot.innerHTML = '';
    if (isStandalone()) return;

    if (installed) {
      slot.innerHTML = '<p class="faint install-note">Installed — open EcoVite from your home screen or apps list.</p>';
      return;
    }

    if (deferredPrompt) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-block install-btn';
      // Inline SVG rather than a "⬇" character, which some phones draw as a
      // coloured emoji; currentColor keeps it matched to the button text.
      btn.innerHTML =
        '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px; margin-right:6px;">' +
        '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>Install app';
      btn.title = 'Install EcoVite on this device so it opens like an app and works with no signal';
      btn.addEventListener('click', async () => {
        const promptEvent = deferredPrompt;
        if (!promptEvent) return;
        btn.disabled = true;
        // Each prompt event can only be used once, whatever the user picks.
        deferredPrompt = null;
        promptEvent.prompt();
        try {
          const { outcome } = await promptEvent.userChoice;
          if (outcome === 'accepted') installed = true;
        } catch {
          // Prompt failed to show; the browser will fire a fresh event later.
        }
        render();
      });
      slot.appendChild(btn);
      return;
    }

    if (isIos()) {
      slot.innerHTML =
        '<p class="faint install-note">Install on iPhone/iPad: tap <strong>Share</strong> ' +
        // Safari's share icon: a box with an arrow pointing up out of it.
        '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">' +
        '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M8 11H6v10h12V11h-2"/></svg>' +
        ' then <strong>Add to Home Screen</strong>.</p>';
    }
  }

  listeners.add(render);
  render();
}
