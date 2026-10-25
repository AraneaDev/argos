/** Dev-only. Screenshots frame pages (from framePage) to PNGs with headless Chrome. */
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const MARGIN = 16;

/** Where a Chrome or Chromium may be installed, in the order they are tried. */
export const BROWSERS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

/**
 * The browser to render with: CAPTURE_CHROME when set (it must exist), or
 * the first of BROWSERS that does.
 */
export function chromePath({ env = process.env, exists = existsSync, candidates = BROWSERS } = {}) {
  if (env.CAPTURE_CHROME) {
    if (!exists(env.CAPTURE_CHROME))
      throw new Error(`CAPTURE_CHROME does not exist: ${env.CAPTURE_CHROME}`);
    return env.CAPTURE_CHROME;
  }
  const found = candidates.find((c) => exists(c));
  if (found === undefined)
    throw new Error(
      `no Chrome or Chromium found (tried ${candidates.join(', ')}); set CAPTURE_CHROME`
    );
  return found;
}

export async function renderPng(pages, outPaths, { cols, rows }) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  try {
    const tab = await browser.newPage();
    await tab.setViewport({
      width: Math.ceil(cols * 8.5) + 2 * MARGIN,
      height: Math.ceil(rows * 17) + 2 * MARGIN,
      deviceScaleFactor: 2,
    });
    for (let i = 0; i < pages.length; i += 1) {
      const file = `${outPaths[i]}.html`;
      await writeFile(file, pages[i]);
      try {
        await tab.goto(`file://${file}`);
        await tab.waitForFunction('window.ready === true');
        const box = await (await tab.$('.xterm-screen')).boundingBox();
        await tab.screenshot({
          path: outPaths[i],
          clip: {
            x: box.x - MARGIN,
            y: box.y - MARGIN,
            width: box.width + 2 * MARGIN,
            height: box.height + 2 * MARGIN,
          },
        });
      } finally {
        await rm(file, { force: true });
      }
    }
  } finally {
    await browser.close();
  }
}
