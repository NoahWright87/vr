// ==============================================================
// PROFILE — the player's name, money, collection, outfit, unlocks and
// records, saved on this device.
//
// An ES module that gives the plain scripts a global, `window.PROFILE`
// (the logic lives in profile-core.js, which node --test covers):
//
//   PROFILE.name / .money / .owned / .outfit / .unlocks / .records
//   PROFILE.earn(amount, reason)    PROFILE.spend(amount, reason) -> bool
//   PROFILE.unlock(id, { source })  PROFILE.has(id)
//   PROFILE.setOutfit(slot, itemId) PROFILE.setName(name)
//   PROFILE.on(fn)                  every change, as { type, ... }
//
// Every change is also announced on `document` as a `profile-change`
// event (detail = the same { type, ... }), which is what UI listens
// for: "+$25 bounty" is a `money` event with delta 25 and reason
// 'bounty'. Phase 02 reacts to the same events.
//
// Storage may be missing or blocked (private windows, cleared site
// data); the profile then simply lives for this visit, and
// PROFILE.persistent says so.
//
// PROFILE.showBackupPanel('export' | 'import') opens a small DOM panel
// with the backup code as text. The panel is a 2D page overlay: fine
// on desktop and phones, not visible inside a headset (TODO.md).
// ==============================================================

import { createProfile, STORAGE_KEY } from './profile-core.js';

function pickStorage() {
  try { return window.localStorage || null; } catch (e) { return null; }
}

const profile = createProfile({ storage: pickStorage() });

profile.on(function (event) {
  try { document.dispatchEvent(new CustomEvent('profile-change', { detail: event })); } catch (e) { /* no DOM */ }
});

// ---------- backup panel ----------

let panel = null;

function closePanel() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  panel = null;
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.assign(node, props || {});
  (children || []).forEach(function (child) { node.appendChild(child); });
  return node;
}

function showBackupPanel(mode) {
  closePanel();
  const importing = mode === 'import';
  const code = importing ? '' : profile.exportCode();

  const area = el('textarea', { id: 'profile-backup-text', rows: 6, value: code, readOnly: !importing });
  area.setAttribute('spellcheck', 'false');
  area.setAttribute('aria-label', importing ? 'Paste a backup code' : 'Your backup code');
  area.style.cssText = 'width:100%;box-sizing:border-box;font:12px monospace;margin:8px 0;';
  const status = el('div', { id: 'profile-backup-status', textContent: importing ? 'Paste a backup code, then press Restore.' : 'Copy this code somewhere safe. It restores your name, money and collection.' });
  status.setAttribute('role', 'status');

  const buttons = [];
  if (importing) {
    buttons.push(el('button', { id: 'profile-backup-restore', type: 'button', textContent: 'Restore' }));
    buttons[0].addEventListener('click', function () {
      const result = profile.importCode(area.value);
      status.textContent = result.ok ? 'Restored. Welcome back, ' + (profile.name || 'stranger') + '.' : result.error;
    });
  } else {
    const copy = el('button', { id: 'profile-backup-copy', type: 'button', textContent: 'Copy' });
    copy.addEventListener('click', function () {
      area.select();
      let done = Promise.resolve(false);
      try { if (navigator.clipboard) done = navigator.clipboard.writeText(code).then(function () { return true; }); } catch (e) { /* fall through */ }
      done.catch(function () { return false; }).then(function (ok) { status.textContent = ok ? 'Copied.' : 'Select the code and copy it by hand.'; });
    });
    buttons.push(copy);
  }
  const close = el('button', { id: 'profile-backup-close', type: 'button', textContent: 'Close' });
  close.addEventListener('click', closePanel);
  buttons.push(close);

  panel = el('div', { id: 'profile-backup-panel' }, [
    el('strong', { textContent: importing ? 'Restore from backup' : 'Backup code' }),
    status, area, el('div', null, buttons),
  ]);
  panel.setAttribute('role', 'dialog');
  // Typing a code must not walk the player around or open menus (WASD, E).
  ['keydown', 'keyup'].forEach(function (type) {
    panel.addEventListener(type, function (evt) { evt.stopPropagation(); });
  });
  panel.style.cssText = 'position:fixed;left:50%;top:20%;transform:translateX(-50%);width:min(480px,90vw);z-index:10000;'
    + 'background:#201812;color:#f3e3c3;border:2px solid #c9a15a;border-radius:8px;padding:12px;font:14px sans-serif;';
  buttons.forEach(function (b) { b.style.cssText = 'margin-right:8px;padding:6px 14px;'; });
  document.body.appendChild(panel);
  area.focus();
}

profile.showBackupPanel = showBackupPanel;
profile.closeBackupPanel = closePanel;
profile.storageKey = STORAGE_KEY;

window.PROFILE = profile;
