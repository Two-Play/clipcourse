// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, startBridge, Workspace, type Bridge } from '@clipcourse/mcp-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from '@playwright/test';
import { clips, openFresh, press } from './helpers.js';

let root: string;
let bridge: Bridge;
let client: Client;

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cc-e2e-bridge-'));
  const workspace = new Workspace({ roots: [root] });
  bridge = await startBridge({ workspace, port: 0 });
  const server = createServer({ workspace, runtime: () => '', bridge });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  client = new Client({ name: 'e2e', version: '1' });
  await client.connect(a);
});

test.afterEach(async () => {
  await client.close();
  await bridge.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  if (result.isError) throw new Error(result.content[0]!.text);
  return JSON.parse(result.content[0]!.text);
}

test('an AI assistant pairs with the open editor and edits live, undoable', async ({ page }) => {
  await openFresh(page);
  await press(page, 'AI assistant');
  const dialog = page.getByRole('dialog', { name: 'Connect an AI assistant' });

  const { code } = await call('pair_editor');
  await dialog.getByLabel('Pairing code').fill(code);
  await dialog.getByText('More options').click();
  await dialog.getByLabel('Assistant address').fill(bridge.url);
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'AI assistant connected (editor:1)' }),
  ).toBeVisible();

  const added = await call('add_clip', {
    project: 'editor:1',
    type: 'text',
    start: 0,
    duration: 4000,
    props: { text: 'Hello from the assistant' },
  });
  await expect(page.locator('.stage-canvas .ccp-text')).toHaveText('Hello from the assistant');
  await expect(page.locator(`.tl-clip[data-clip-id="${added.created.clipId}"]`)).toBeVisible();
  await expect(page.locator('.ai-status')).toContainText('Added text clip');

  // The user's own edits reach the assistant.
  await press(page, 'Box');
  await expect
    .poll(async () =>
      JSON.stringify(await call('get_course', { project: 'editor:1', format: 'json' })),
    )
    .toContain('"type":"box"');

  // Undo in the editor works on the assistant's change too.
  await page.locator('.tl-ruler').click({ position: { x: 5, y: 10 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await clips(page)).toHaveLength(0);

  await page.locator('.ai-status').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('.ai-status')).toHaveCount(0);
  await expect.poll(async () => (await call('list_projects')).editors).toEqual([]);
});

test('a wrong code is refused and explained', async ({ page }) => {
  await openFresh(page);
  await press(page, 'AI assistant');
  const dialog = page.getByRole('dialog', { name: 'Connect an AI assistant' });
  const { code } = await call('pair_editor');
  await dialog.getByLabel('Pairing code').fill(code === '000000' ? '000001' : '000000');
  await dialog.getByText('More options').click();
  await dialog.getByLabel('Assistant address').fill(bridge.url);
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Wrong pairing code');
});

test('only local assistants are accepted', async ({ page }) => {
  await openFresh(page);
  await press(page, 'AI assistant');
  const dialog = page.getByRole('dialog', { name: 'Connect an AI assistant' });
  await dialog.getByLabel('Pairing code').fill('123456');
  await dialog.getByText('More options').click();
  await dialog.getByLabel('Assistant address').fill('ws://evil.example/bridge');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Only a local assistant');
});
