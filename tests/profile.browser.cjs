// Player profile, driven the way a player drives it (phase 01-C).
//
// Opens the watch with the real keyboard path (Tab, then E to enter the
// menu, then W/S/D/A/Enter), types a name through the Profile > Name
// rows, and checks it survives a reload. Also: storage blocked, the
// backup panel round trip, and the economy events reaching the page.
//
//   npm run build && npm run preview -- --port 4173   (separate shell)
//   VR_TEST_URL=http://127.0.0.1:4173 node tests/profile.browser.cjs
const { chromium } = require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.VR_TEST_URL || 'http://127.0.0.1:4173';
const url = base + '/games/pistols-at-dawn/';

const launchOptions = {
  executablePath: process.env.VR_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
};

// The open watch's menu model.
const openMenu = `(() => {
  const c = [...document.querySelectorAll('[crossbar-menu]')]
    .map((e) => e.components['crossbar-menu']).find((x) => x && x.menu.isOpen);
  return c && c.menu;
})()`;

async function load(context, errors) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.PROFILE && document.querySelector('a-scene') && document.querySelector('a-scene').hasLoaded, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  return page;
}

const focusLabel = (page) => page.evaluate(`(${openMenu}).focusedRow().label`);
const title = (page) => page.evaluate(`(${openMenu}).level().title`);

async function openWatch(page) {
  // The watch is entered with Tab then E; right after a load the first
  // press can land before desktop-controls is ready, so try a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(800);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(800);
    await page.keyboard.press('KeyE');
    try {
      await page.waitForFunction(`!!(${openMenu})`, null, { timeout: 4000 });
      return;
    } catch (e) {
      await closeWatch(page);
    }
  }
  throw new Error('the watch menu never opened');
}

async function closeWatch(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

// Scroll the focused level until a row whose label starts with `label` is focused.
async function focus(page, label, key = 'ArrowDown') {
  for (let i = 0; i < 80; i++) {
    const here = await focusLabel(page);
    if (here.startsWith(label)) return;
    await page.keyboard.press(key);
  }
  throw new Error('never focused "' + label + '"; stuck on "' + (await focusLabel(page)) + '"');
}
async function enter(page, label, key) { await focus(page, label, key); await page.keyboard.press('Enter'); }
async function back(page) { await page.keyboard.press('ArrowLeft'); }

// Profile > Name > Letter n = ch, using the real select rows.
async function setLetter(page, n, ch) {
  await enter(page, 'Letter ' + n + ':');
  await focus(page, ch);
  await back(page);
}

(async () => {
  const browser = await chromium.launch(launchOptions);
  const errors = [];
  try {
    // ---------- a name through the watch, then a reload ----------
    const context = await browser.newContext({ viewport: { width: 480, height: 320 } });
    let page = await load(context, errors);
    assert.equal(await page.evaluate(() => PROFILE.name), '');
    assert.equal(await page.evaluate(() => PROFILE.persistent), true);

    await openWatch(page);
    await enter(page, 'Profile');
    assert.equal(await title(page), 'Profile');
    await enter(page, 'Name');
    for (const [n, ch] of [[1, 'J'], [2, 'E'], [3, 'D']]) await setLetter(page, n, ch);
    assert.equal(await page.evaluate(() => PROFILE.name), 'JED');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pistols-at-dawn:profile')).name), 'JED');
    await back(page);
    assert.equal(await focusLabel(page), 'Name: JED');
    await closeWatch(page);

    await page.reload();
    await page.waitForFunction(() => window.PROFILE && document.querySelector('a-scene').hasLoaded, null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(() => PROFILE.name), 'JED', 'name survives a reload');
    await openWatch(page);
    await enter(page, 'Profile');
    assert.equal(await focusLabel(page), 'Name: JED', 'the menu shows the saved name');
    // Re-opening the name rows shows the letters that were saved.
    await enter(page, 'Name');
    await focus(page, 'Letter 2:');
    assert.equal(await focusLabel(page), 'Letter 2: E');

    // Quick pick and Clear name.
    await enter(page, 'Quick pick');
    await focus(page, 'LUCKY');
    await back(page);
    assert.equal(await page.evaluate(() => PROFILE.name), 'LUCKY');
    await enter(page, 'Clear name', 'ArrowUp');
    assert.equal(await page.evaluate(() => PROFILE.name), '');
    await closeWatch(page);

    // ---------- economy events reach the page ----------
    const events = await page.evaluate(() => new Promise((resolve) => {
      const seen = [];
      document.addEventListener('profile-change', (e) => seen.push(e.detail));
      PROFILE.earn(25, 'bounty');
      PROFILE.unlock('duel:noon', { source: 'room' });
      const refused = PROFILE.spend(1000, 'gold toilet');
      resolve({ seen, refused, money: PROFILE.money });
    }));
    assert.deepEqual(events.seen[0], { type: 'money', delta: 25, money: 25, reason: 'bounty' });
    assert.deepEqual(events.seen[1], { type: 'unlock', id: 'duel:noon', source: 'room' });
    assert.equal(events.refused, false);
    await page.reload();
    await page.waitForFunction(() => window.PROFILE && document.querySelector('a-scene').hasLoaded, null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => PROFILE.money), 25, 'money survives a reload');
    assert.equal(await page.evaluate(() => PROFILE.has('duel:noon')), true);
    await page.waitForTimeout(1500);

    // ---------- backup code, through the menu and the panel ----------
    await page.evaluate(() => PROFILE.setName('Backup Bob'));
    await openWatch(page);
    await enter(page, 'Profile');
    assert.equal(await page.evaluate(`(${openMenu}).level().items.find((i) => i.id === 'pistols-profile-money').label`), 'Money: $25');
    await enter(page, 'Backup');
    await enter(page, 'Show backup code');
    await page.waitForSelector('#profile-backup-panel');
    const code = await page.inputValue('#profile-backup-text');
    assert.match(code, /^PAD1\./);
    await page.click('#profile-backup-close');
    assert.equal(await page.locator('#profile-backup-panel').count(), 0);
    await closeWatch(page);

    // A different, empty device restores it through Restore backup.
    const other = await browser.newContext({ viewport: { width: 480, height: 320 } });
    const page2 = await load(other, errors);
    assert.equal(await page2.evaluate(() => PROFILE.money), 0);
    await openWatch(page2);
    await enter(page2, 'Profile');
    await enter(page2, 'Backup');
    await enter(page2, 'Restore backup');
    await page2.waitForSelector('#profile-backup-panel');
    await page2.fill('#profile-backup-text', 'PAD1.garbage.00000000');
    await page2.click('#profile-backup-restore');
    assert.match(await page2.textContent('#profile-backup-status'), /damaged|not a Pistols/);
    assert.equal(await page2.evaluate(() => PROFILE.money), 0, 'a bad code changes nothing');
    await page2.fill('#profile-backup-text', code);
    // Typing in the panel must not drive the game's key handlers.
    await page2.click('#profile-backup-restore');
    assert.match(await page2.textContent('#profile-backup-status'), /Restored/);
    assert.equal(await page2.evaluate(() => PROFILE.name), 'BACKUP BOB');
    assert.equal(await page2.evaluate(() => PROFILE.money), 25);
    await page2.reload();
    await page2.waitForFunction(() => window.PROFILE && document.querySelector('a-scene').hasLoaded, null, { timeout: 90000 });
    assert.equal(await page2.evaluate(() => PROFILE.name), 'BACKUP BOB', 'a restored profile is saved');
    await other.close();
    await context.close();

    // ---------- storage blocked: the game still loads and plays ----------
    const blocked = await browser.newContext({ viewport: { width: 480, height: 320 } });
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    const page3 = await load(blocked, errors);
    assert.equal(await page3.evaluate(() => PROFILE.persistent), false);
    assert.equal(await page3.evaluate(() => PROFILE.name), '');
    await openWatch(page3);
    await enter(page3, 'Profile');
    await focus(page3, 'Saving: Off');
    await enter(page3, 'Name', 'ArrowUp');
    await setLetter(page3, 1, 'Z');
    assert.equal(await page3.evaluate(() => PROFILE.name), 'Z', 'names still work for this visit');
    assert.equal(await page3.evaluate(() => PROFILE.earn(5, 'x') && PROFILE.money), 5);
    await blocked.close();

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join('; '));
    console.log('profile.browser: ok');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
