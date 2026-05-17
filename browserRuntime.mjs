import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const profileDir = resolve('./.runtime/browser-profile');
const maxResultsPerAdapter = 10;
const maxDetailPagesPerAdapter = 8;

let playwrightModulePromise;
const contexts = new Map();
const panelTasks = new Map();

async function loadPlaywright() {
  playwrightModulePromise ??= import('playwright').catch((error) => ({ error }));
  const loaded = await playwrightModulePromise;
  if (loaded.error) return { available: false, error: loaded.error.message };
  return { available: true, playwright: loaded };
}

let browserStarted = false;

export async function browserRuntimeStatus() {
  const loaded = await loadPlaywright();
  if (!loaded.available) {
    return { available: false, provider: 'playwright-chromium', error: loaded.error ?? 'Install Playwright: npm install playwright && npx playwright install chromium' };
  }
  const panels = [];
  for (const [panelId, task] of panelTasks) {
    panels.push({
      panelId,
      status: task.status,
      siteName: task.siteName,
      url: task.url,
    });
  }
  return { available: true, provider: 'playwright-chromium', started: browserStarted, panels };
}

async function detectVerificationPage(page) {
  const title = await page.title().catch(() => '');
  const url = page.url();
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

  return (
    /just a moment|checking your browser|attention required/i.test(title) ||
    /\/cdn-cgi\/|challenge-platform/i.test(url) ||
    /verify you are human|checking if the site connection is secure/i.test(text)
  );
}

async function ensureContext(playwright) {
  await mkdir(profileDir, { recursive: true });
  if (contexts.has('shared')) return contexts.get('shared');
  const context = await playwright.chromium.launchPersistentContext(resolve(profileDir), {
    headless: false,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
    userAgent: 'Mozilla/5.0 BitResourceFinder/0.4 headed-browser metadata-only local app',
  });
  contexts.set('shared', context);
  return context;
}

async function firstPage(context) {
  const [page] = context.pages();
  return page ?? context.newPage();
}

export async function startBrowser() {
  const loaded = await loadPlaywright();
  if (!loaded.available) return { ok: false, error: loaded.error ?? 'Playwright is not installed.' };
  await ensureContext(loaded.playwright);
  browserStarted = true;
  return { ok: true };
}

export async function openBrowserPanel(panelId, url) {
  const loaded = await loadPlaywright();
  if (!loaded.available) return { ok: false, error: loaded.error };
  const context = await ensureContext(loaded.playwright);
  const page = await firstPage(context);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
  panelTasks.set(panelId, {
    panelId,
    status: 'idle',
    siteName: url,
    url,
    page,
  });
  return { ok: true };
}

export async function runBrowserSearch(body) {
  const { adapterId, keyword, panelId } = body;
  const loaded = await loadPlaywright();
  if (!loaded.available) return { status: 'failed', results: [], message: loaded.error };
  const context = await ensureContext(loaded.playwright);
  const page = await firstPage(context);

  const adaptersStore = panelTasks.get('_adapters') || {};
  const adapter = adaptersStore[adapterId];
  if (!adapter) {
    return { status: 'failed', results: [], message: `Adapter ${adapterId} not found`, panelId, adapterId };
  }

  panelTasks.set(panelId, {
    panelId,
    status: 'loading',
    siteName: adapter.name,
    url: adapter.homeUrl,
    page,
  });

  try {
    await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    if (await detectVerificationPage(page)) {
      panelTasks.set(panelId, {
        panelId,
        status: 'need_human_verification',
        siteName: adapter.name,
        url: page.url(),
        page,
        searchPending: { adapter, keyword },
      });
      return { status: 'need_human_verification', results: [], message: '检测到验证页面，请人工完成验证后继续', panelId, adapterId };
    }

    if (adapter.searchInputSelector) {
      await page.locator(adapter.searchInputSelector).fill(keyword, { timeout: 15_000 }).catch(() => {});
      if (adapter.searchButtonSelector) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined),
          page.locator(adapter.searchButtonSelector).click({ timeout: 15_000 }).catch(() => {}),
        ]);
      } else {
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
      }
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

      if (await detectVerificationPage(page)) {
        panelTasks.set(panelId, {
          panelId,
          status: 'need_human_verification',
          siteName: adapter.name,
          url: page.url(),
          page,
          searchPending: { adapter, keyword },
        });
        return { status: 'need_human_verification', results: [], message: '搜索后检测到验证页面', panelId, adapterId };
      }
    }

    panelTasks.set(panelId, {
      panelId,
      status: 'extracting',
      siteName: adapter.name,
      url: page.url(),
      page,
    });

    const results = await extractResultsFromPage(page, adapter, page.url());
    const resultLinks = await collectResultLinks(page, adapter);

    for (const link of resultLinks.slice(0, maxDetailPagesPerAdapter)) {
      await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
      if (await detectVerificationPage(page)) continue;
      const detailMagnets = await collectMagnetsFromPage(page, adapter, link.title, page.url());
      results.push(...detailMagnets);
    }

    const unique = Array.from(new Map(results.map((item) => [item.magnetUri, item])).values()).slice(0, maxResultsPerAdapter);

    panelTasks.set(panelId, {
      panelId,
      status: 'done',
      siteName: adapter.name,
      url: page.url(),
      page,
    });

    return { status: 'ok', results: unique, message: `提取到 ${unique.length} 条磁力链接`, panelId, adapterId };
  } catch (error) {
    panelTasks.set(panelId, {
      panelId,
      status: 'failed',
      siteName: adapter.name,
      url: page?.url() ?? '',
      page,
      error: error.message,
    });
    return { status: 'failed', results: [], message: error.message, panelId, adapterId };
  }
}

export async function continueAfterVerification(panelId) {
  const task = panelTasks.get(panelId);
  if (!task || !task.searchPending) {
    return { ok: false, error: 'No pending task for this panel' };
  }

  const { adapter, keyword } = task.searchPending;
  const page = task.page;

  try {
    if (!adapter.searchInputSelector) {
      return { ok: false, error: 'No search input selector' };
    }

    await page.locator(adapter.searchInputSelector).fill(keyword, { timeout: 15_000 }).catch(() => {});
    if (adapter.searchButtonSelector) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined),
        page.locator(adapter.searchButtonSelector).click({ timeout: 15_000 }).catch(() => {}),
      ]);
    } else {
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    if (await detectVerificationPage(page)) {
      panelTasks.set(panelId, {
        ...task,
        status: 'need_human_verification',
        url: page.url(),
        searchPending: { adapter, keyword },
      });
      return { ok: false, needVerification: true, message: '仍检测到验证页面' };
    }

    const results = await extractResultsFromPage(page, adapter, page.url());
    const resultLinks = await collectResultLinks(page, adapter);

    for (const link of resultLinks.slice(0, maxDetailPagesPerAdapter)) {
      await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
      if (await detectVerificationPage(page)) continue;
      const detailMagnets = await collectMagnetsFromPage(page, adapter, link.title, page.url());
      results.push(...detailMagnets);
    }

    const unique = Array.from(new Map(results.map((item) => [item.magnetUri, item])).values()).slice(0, maxResultsPerAdapter);

    panelTasks.set(panelId, {
      panelId,
      status: 'done',
      siteName: adapter.name,
      url: page.url(),
      page,
    });

    return { ok: true, results: unique };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function extractDetailPage(body) {
  const { adapterId, panelId, detailUrl } = body;
  const loaded = await loadPlaywright();
  if (!loaded.available) return { status: 'failed', title: '', detailUrl, magnet: '', message: loaded.error };
  const context = await ensureContext(loaded.playwright);
  const page = await firstPage(context);

  const adaptersStore = panelTasks.get('_adapters') || {};
  const adapter = adaptersStore[adapterId];

  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (await detectVerificationPage(page)) {
      return { status: 'need_human_verification', title: '', detailUrl, magnet: '', message: '检测到验证页面' };
    }

    const title = await page.title().catch(() => '');
    const selector = adapter?.magnetLinkSelector?.trim() || 'a[href^="magnet:"]';
    const elements = await page.$$(selector);
    let magnet = '';

    for (const element of elements) {
      const href = await element.getAttribute('href');
      if (href && href.startsWith('magnet:')) {
        magnet = href;
        break;
      }
    }

    return {
      status: 'ok',
      title: title || detailUrl,
      detailUrl: page.url(),
      magnet,
      message: magnet ? '提取成功' : '未找到磁力链接',
    };
  } catch (error) {
    return { status: 'failed', title: '', detailUrl, magnet: '', message: error.message };
  }
}

async function extractResultsFromPage(page, adapter, pageUrl) {
  return collectMagnetsFromPage(page, adapter, await page.title().catch(() => adapter.name), pageUrl);
}

async function collectMagnetsFromPage(page, adapter, fallbackTitle, detailUrl) {
  const selector = adapter.magnetLinkSelector?.trim() || 'a[href^="magnet:"]';
  try {
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
  } catch {
    return [];
  }
}

async function collectResultLinks(page, adapter) {
  if (!adapter.resultItemSelector) return [];
  try {
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
  } catch {
    return [];
  }
}

export function storeAdapters(adapters) {
  panelTasks.set('_adapters', Object.fromEntries(adapters.map((a) => [a.id, a])));
}

export async function closeBrowserRuntime() {
  await Promise.all(Array.from(contexts.values()).map((context) => context.close().catch(() => undefined)));
  contexts.clear();
  browserStarted = false;
}

process.once('SIGINT', () => closeBrowserRuntime().finally(() => process.exit(0)));
process.once('SIGTERM', () => closeBrowserRuntime().finally(() => process.exit(0)));
