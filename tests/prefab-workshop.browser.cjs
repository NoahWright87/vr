// Optional rendered checks for the Prefab Workshop (primitives/prefabs/): the real
// page, real mouse events through the gizmo, the real clipboard and a real reload.
//   npm run dev   (or preview), then:  VR_TEST_URL=http://localhost:5173 node tests/prefab-workshop.browser.cjs
const { chromium } = require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.VR_TEST_URL || 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.VR_CHROMIUM || undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !/favicon/.test(response.url())) errors.push(`${response.status()} ${response.url()}`); });
    const open = async query => {
      await page.goto(`${base}/primitives/prefabs/${query}`);
      await page.waitForFunction(() => window.workshop?.view.prefabEl.getObject3D('prefab-model')?.children.length > 0, null, { timeout: 30000 });
      await page.waitForTimeout(600);
    };
    const state = () => page.evaluate(() => ({
      changed: window.workshop.store.changedCount(), changes: window.workshop.store.changes(),
      entry: JSON.parse(JSON.stringify(window.workshop.entry() ?? null)), selection: window.workshop.selection,
    }));

    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await open('?prefab=smg-d');

    // Opens on a committed prefab, nothing changed, with hands and emitters drawn.
    let s = await state();
    assert.equal(s.entry.name, 'SMG');
    assert.equal(s.changed, 0);
    assert.deepEqual(s.selection, { kind: 'occupant', i: 0, j: 0, left: false });
    assert.equal(await page.evaluate(() => window.workshop.view.gizmoVisible), true);
    assert.ok(await page.locator('#list .item.current').count() === 1, 'the open prefab is marked in the list');
    console.log('opens: ok');

    // Editing a field is a change; the header counts it.
    await page.locator('input[title="mass in kilograms"]').fill('3.1');
    s = await state();
    assert.equal(s.changed, 1);
    assert.equal(s.entry.massKg, 3.1);
    assert.match(await page.locator('#copy-changed').textContent(), /\(1\)/);
    console.log('edit counts: ok');

    // Dragging the translate arrow with a real mouse moves the selected hand along that axis only.
    const before = s.entry.interactions[0].occupants[0].pos;
    const grab = await page.evaluate(() => window.workshop.view.handleScreenPoint('translate', 0, 0.7));
    const tip = await page.evaluate(() => window.workshop.view.handleScreenPoint('translate', 0, 1.0));
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + (tip.x - grab.x) * 1.5, grab.y + (tip.y - grab.y) * 1.5, { steps: 6 });
    await page.mouse.up();
    s = await state();
    const after = s.entry.interactions[0].occupants[0].pos;
    assert.notEqual(after[0], before[0], 'x changed');
    assert.equal(after[1], before[1], 'y untouched');
    assert.equal(after[2], before[2], 'z untouched');
    assert.equal(Number(await page.locator('input[title="position x"]').nth(1).inputValue()), Math.round(after[0] * 1000) / 1000, 'the field follows the drag');
    console.log('translate drag: ok', before[0], '->', after[0]);

    // Dragging a ring turns it about that axis only.
    const rotBefore = s.entry.interactions[0].occupants[0].rot;
    const ring = await page.evaluate(() => window.workshop.view.handleScreenPoint('rotate', 1));
    await page.mouse.move(ring.x, ring.y);
    await page.mouse.down();
    await page.mouse.move(ring.x + 40, ring.y + 25, { steps: 6 });
    await page.mouse.up();
    s = await state();
    assert.notDeepEqual(s.entry.interactions[0].occupants[0].rot, rotBefore, 'the hand turned');
    console.log('rotate drag: ok');

    // Orbiting on empty space does not edit anything.
    const changesBefore = JSON.stringify((await state()).changes);
    await page.mouse.move(1000, 820);
    await page.mouse.down();
    await page.mouse.move(900, 780, { steps: 5 });
    await page.mouse.up();
    assert.equal(JSON.stringify((await state()).changes), changesBefore);
    console.log('orbit: ok');

    // Copy puts exactly the changed prefab on the clipboard, in the export format.
    await page.click('#copy-changed');
    await page.waitForTimeout(300);
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(copied.format, 'prefab-export/1');
    assert.deepEqual(Object.keys(copied.prefabs), ['smg-d']);
    assert.deepEqual(copied.poses, {});
    assert.equal(copied.prefabs['smg-d'].massKg, 3.1);
    assert.equal(copied.prefabs['smg-d'].model, 'kenney-blaster-kit-blaster-d', 'a changed prefab is whole');
    console.log('copy changed: ok');

    // The edits survive a reload.
    await open('?prefab=smg-d');
    s = await state();
    assert.equal(s.changed, 1);
    assert.equal(s.entry.massKg, 3.1);
    console.log('reload keeps edits: ok');

    // A new pose, edited with the sliders, drives the hand and shows up in the export.
    await page.click('#tabs button[data-tab="poses"]');
    await page.locator('#panel .row:has(.lab:text-is("name")) input').fill('trigger-finger');
    await page.click('text=Duplicate as');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.workshop.poseName), 'trigger-finger');
    await page.locator('input[title="index curl, all joints"]').nth(1).fill('0.8');
    s = await state();
    assert.ok(s.changes.poses['trigger-finger'], 'the new pose is a change');
    assert.equal(s.changes.poses['trigger-finger'].fingers.index, 0.8);
    const bent = await page.evaluate(() => window.workshop.view.preview.poseName);
    assert.equal(bent, 'trigger-finger');
    console.log('new pose: ok');

    // Using the new pose from a hand position, then discarding everything, goes back to the commit.
    await page.click('#tabs button[data-tab="prefab"]');
    await page.locator('select[title="pose"]').first().selectOption('trigger-finger');
    s = await state();
    assert.equal(s.entry.interactions[0].occupants[0].pose, 'trigger-finger');
    await page.click('#tabs button[data-tab="export"]');
    page.once('dialog', dialog => dialog.accept());
    await page.click('text=Discard all');
    await page.waitForTimeout(300);
    s = await state();
    assert.equal(s.changed, 0);
    assert.equal(s.entry.massKg, 2.4);
    console.log('discard all: ok');

    // A model with no prefab offers to make one.
    await open('?model=kenney-blaster-kit-blaster-b');
    assert.equal(await page.evaluate(() => window.workshop.prefabId), null);
    await page.click('text=Create prefab');
    s = await state();
    assert.equal(s.entry.model, 'kenney-blaster-kit-blaster-b');
    assert.deepEqual(Object.keys(s.changes.prefabs), ['blaster-b']);
    console.log('create prefab: ok');

    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    console.log('prefab workshop: all ok');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
