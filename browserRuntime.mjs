import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const dataDir = resolve('data', 'browser-profiles');
const maxResultsPerAdapter = 10;
const maxDetailPagesPerAdapter = 8;

let playwrightModulePromise;
const contexts = new Map();

async function loadPlaywright() {
  playwrightModulePromise ??= import('playwright').catch((error) => ({ error }));
  const loaded = await playwrightModulePromise;
  if (loaded.error) return { available: false, error: loaded.error.message };
  return { available: true, playwright: loaded };
}

export async function browserRuntimeStatus() {
  const loaded = await loadPlaywright();
  return loaded.available
    ? { available: true, provider: 'playwright-chromium', profilesDir: dataDir }
    : { available: false, provider: 'playwright-chromium', error: loaded.error ?? 'Install Playwright to enable headed browser automation: npm install playwright && npx playwright install chromium' };
}

function detectCloudflareText(text) {
  return /just a moment|cf-browser-verification|cf-challenge|checking your browser|cloudflare/i.test(text);
}

async function ensureContext(playwright, paneId) {
  await mkdir(dataDir, { recursive: true });
  if (contexts.has(paneId)) return contexts.get(paneId);
  const context = await playwright.chromium.launchPersistentContext(resolve(dataDir, paneId), {
    headless: process.env.BROWSER_HEADLESS === '1',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
    userAgent: 'Mozilla/5.0 BitResourceFinder/0.3 headed-browser metadata-only local app',
  });
  contexts.set(paneId, context);
  return context;
}

async function firstPage(context) {
  const [page] = context.pages();
  return page ?? context.newPage();
}

async function isVerificationPage(page) {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
  return detectCloudflareText(`${title}\n${body}`);
}

async function gotoAndSettle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

async function collectMagnetsFromPage(page, adapter, fallbackTitle, detailUrl) {
  const selector = adapter.magnetLinkSelector?.trim() || 'a[href^="magnet:"]';
  return page.$$eval(
    selector,
    (elements, args) => elements
      .map((element, index) => {
        const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href') || '';
        if (!href.startsWith('magnet:')) return undefined;
        const container = args.resultItemSelector ? element.closest(args.resultItemSelector) : element.closest('article, li, tr, div');
        const title = (container?.textContent || element.textContent || args.fallbackTitle || `Magnet ${index + 1}`).replace(/\s+/g, ' ').trim();
        return {
          id: `${args.adapterId}-${Date.now()}-${index}`,
          sourceAdapterId: args.adapterId,
          sourceName: args.sourceName,
          title,
          magnetUri: href,
          detailUrl: args.detailUrl,
        };
      })
      .filter(Boolean),
    {
      adapterId: adapter.id,
      sourceName: adapter.name,
      resultItemSelector: adapter.resultItemSelector,
      fallbackTitle,
      detailUrl,
    },
  );
}

async function collectResultLinks(page, adapter) {
  if (!adapter.resultItemSelector) return [];
  return page.$$eval(
    adapter.resultItemSelector,
    (elements) => elements.slice(0, 10).map((element) => {
      const anchor = element instanceof HTMLAnchorElement ? element : element.querySelector('a[href]');
      const href = anchor?.href || '';
      return href && !href.startsWith('magnet:')
        ? { url: href, title: (element.textContent || anchor?.textContent || href).replace(/\s+/g, ' ').trim() }
        : undefined;
    }).filter(Boolean),
  );
}

async function runAdapterInBrowser(playwright, adapter, query, index) {
  const context = await ensureContext(playwright, `pane-${index}`);
  const page = await firstPage(context);
  const startUrl = adapter.searchUrlTemplate
    ? adapter.searchUrlTemplate.replaceAll('{query}', encodeURIComponent(query))
    : adapter.homeUrl;

  await gotoAndSettle(page, adapter.searchUrlTemplate ? startUrl : adapter.homeUrl);
  if (await isVerificationPage(page)) {
    return { adapterId: adapter.id, status: 'verification-required', results: [], message: 'Verification page detected; complete it in the headed browser window and run search again.' };
  }

  if (!adapter.searchUrlTemplate && adapter.searchInputSelector) {
    await page.locator(adapter.searchInputSelector).fill(query, { timeout: 15_000 });
    if (adapter.searchButtonSelector) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined),
        page.locator(adapter.searchButtonSelector).click({ timeout: 15_000 }),
      ]);
    } else {
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  }

  if (await isVerificationPage(page)) {
    return { adapterId: adapter.id, status: 'verification-required', results: [], message: 'Verification page detected after search.' };
  }

  const pageUrl = page.url();
  const fallbackTitle = await page.title().catch(() => adapter.name);
  const collected = await collectMagnetsFromPage(page, adapter, fallbackTitle, pageUrl);
  const resultLinks = await collectResultLinks(page, adapter);

  for (const link of resultLinks.slice(0, maxDetailPagesPerAdapter)) {
    await gotoAndSettle(page, link.url).catch(() => undefined);
    if (await isVerificationPage(page)) continue;
    collected.push(...await collectMagnetsFromPage(page, adapter, link.title, page.url()));
  }

  const results = Array.from(new Map(collected.map((item) => [item.magnetUri, item])).values()).slice(0, maxResultsPerAdapter);
  return { adapterId: adapter.id, status: 'done', results, message: `Collected ${results.length} magnet links with headed browser automation.` };
}

async function withConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function runBrowserSearch({ query, adapters, concurrency = 1 }) {
  const loaded = await loadPlaywright();
  if (!loaded.available) return { ok: false, unavailable: true, error: loaded.error ?? 'Playwright is not installed.' };
  const activeAdapters = adapters.slice(0, Math.max(1, Math.min(4, concurrency)));
  const adapterRuns = await withConcurrency(activeAdapters, concurrency, (adapter, index) => runAdapterInBrowser(loaded.playwright, adapter, query, index));
  return {
    ok: true,
    provider: 'playwright-chromium',
    adapterRuns,
    results: adapterRuns.flatMap((run) => run.results),
  };
}

export async function closeBrowserRuntime() {
  await Promise.all(Array.from(contexts.values()).map((context) => context.close().catch(() => undefined)));
  contexts.clear();
}

process.once('SIGINT', () => closeBrowserRuntime().finally(() => process.exit(0)));
process.once('SIGTERM', () => closeBrowserRuntime().finally(() => process.exit(0)));
