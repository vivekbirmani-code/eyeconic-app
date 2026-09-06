/**
 * Browser-level verification that question images render in the public quiz.
 *
 * Drives the REAL web client (Vite dev server) in headless Edge as an
 * unauthenticated public participant with a minted guest token:
 *
 *   /public-quiz/<shareToken>/take  ->  navigate to the image question
 *   ->  assert the <img> request to res.cloudinary.com returned 200
 *   ->  screenshot  ->  Submit test  ->  result page review
 *   ->  assert the review image request returned 200  ->  screenshot
 *
 * Usage:
 *   node scripts/verifyPublicQuizImages.mjs <guestToken> <shareToken> [desktop|mobile]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// VERIFY_WEB_ORIGIN=https://… runs the same flow against a deployed web app
// (its own VITE_API_URL then points the page at the deployed backend).
const WEB = process.env.VERIFY_WEB_ORIGIN || 'http://localhost:5173';

const guestToken = process.argv[2];
const shareToken = process.argv[3];
const formFactor = process.argv[4] || 'desktop';
if (!guestToken || !shareToken) {
  console.error('Usage: node scripts/verifyPublicQuizImages.mjs <guestToken> <shareToken> [desktop|mobile]');
  process.exit(2);
}

const outDir = join(tmpdir(), 'eyeconic-image-verify');
mkdirSync(outDir, { recursive: true });

const viewport = formFactor === 'mobile'
  ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { width: 1280, height: 900 };

const log = (ok, label, extra = '') =>
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: viewport,
  });
  const page = await browser.newPage();

  // Record every Cloudinary image request + its HTTP status.
  const cloudinaryResponses = [];
  page.on('response', (r) => {
    if (r.url().includes('res.cloudinary.com')) {
      cloudinaryResponses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] });
    }
  });

  let allOk = true;
  const check = (ok, label, extra) => { allOk = allOk && ok; log(ok, label, extra); };

  // Seed the guest session, then open the taking page directly (it starts or
  // resumes the attempt itself when a guestToken is present).
  await page.goto(`${WEB}/public-quiz/${shareToken}`, { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('guestToken', t), guestToken);
  await page.goto(`${WEB}/public-quiz/${shareToken}/take`, { waitUntil: 'networkidle2' });

  // The taking page loads questions via POST /start; wait for the palette.
  await page.waitForSelector('.flex.flex-wrap.gap-2 button', { timeout: 30000 });
  const paletteCount = (await page.$$('.flex.flex-wrap.gap-2 button')).length;
  check(paletteCount >= 1, `attempt started — palette has ${paletteCount} questions`);

  // Jump to the image question: first question whose card renders a
  // cloudinary <img> after clicking its palette button.
  let imageQuestionIndex = -1;
  let imgSrc = null;
  for (let i = paletteCount - 1; i >= 0; i--) {
    const buttons = await page.$$('.flex.flex-wrap.gap-2 button');
    await buttons[i].click();
    try {
      await page.waitForSelector('img[src*="res.cloudinary.com"]', { timeout: 2500 });
    } catch {
      continue;
    }
    imageQuestionIndex = i;
    imgSrc = await page.$eval('img[src*="res.cloudinary.com"]', (el) => el.src);
    break;
  }
  check(imageQuestionIndex >= 0, 'found an image-based question (palette position ' + (imageQuestionIndex + 1) + ')');
  if (imageQuestionIndex < 0) {
    console.log(`\n${formFactor}: no image question rendered — aborting further checks`);
    await browser.close();
    process.exit(1);
  }

  // Give the <img> a moment to finish its network request, then verify it.
  await new Promise((r) => setTimeout(r, 2500));
  const attemptImageResp = cloudinaryResponses.find((r) => r.url === imgSrc && r.status === 200);
  check(!!attemptImageResp, `attempt image HTTP 200 (${imgSrc.split('/').pop()})`,
    attemptImageResp ? `${attemptImageResp.type} ${attemptImageResp.status}` : 'no successful response captured');

  const rendered = await page.$eval('img[src*="res.cloudinary.com"]', (el) => ({
    complete: el.complete,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    alt: el.alt,
  }));
  check(rendered.complete && rendered.naturalWidth > 0 && rendered.naturalHeight > 0,
    `image actually decoded (${rendered.naturalWidth}x${rendered.naturalHeight}px, alt="${rendered.alt}")`);
  const placeholderShown = await page.evaluate(() => document.body.innerText.includes('Image being updated'));
  check(!placeholderShown, 'no "Image being updated" placeholder text on the page');

  await page.screenshot({ path: join(outDir, `${formFactor}-attempt-image-question.png`), fullPage: false });

  // Answer the question (first option), then submit the whole test.
  const answerTarget = await page.$('main label');
  if (answerTarget) await answerTarget.click().catch(() => {});

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('footer button')];
    const submit = btns.find((b) => b.textContent.includes('Submit Test'));
    if (submit) submit.click();
  });
  await page.waitForFunction(() => !![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit test'), { timeout: 10000 });
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit test');
    if (confirm) confirm.click();
  });

  // Result page (route push after grading).
  await page.waitForFunction(() => location.pathname.includes('/result/'), { timeout: 30000 });
  // The review renders one question at a time — wait for its palette to know
  // the result payload has landed, then jump to the image question.
  await page.waitForSelector('button[aria-label^="Question "]', { timeout: 30000 });
  check(page.url().includes('/result/'), `result page reached (${page.url().split('/').slice(-2).join('/')})`);

  await page.evaluate((pos) => {
    const prefix = `Question ${pos} —`;
    const btn = [...document.querySelectorAll('button[aria-label^="Question "]')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith(prefix));
    if (btn) btn.click();
  }, imageQuestionIndex + 1);
  try {
    await page.waitForSelector('img[src*="res.cloudinary.com"]', { timeout: 20000 });
  } catch {
    const labels = await page.$$eval('button[aria-label^="Question "]', (els) => els.map((e) => e.getAttribute('aria-label')));
    const bodySnippet = (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g, ' | ');
    console.log(`  DEBUG review palette labels: ${JSON.stringify(labels)}`);
    console.log(`  DEBUG body: ${bodySnippet}`);
    await page.screenshot({ path: join(outDir, `${formFactor}-review-debug.png`), fullPage: true });
    throw new Error('review image never rendered');
  }
  const reviewSrc = await page.$$eval('img[src*="res.cloudinary.com"]', (els) => els[els.length - 1].src);
  await new Promise((r) => setTimeout(r, 2500));
  const reviewResp = cloudinaryResponses.find((r) => r.url === reviewSrc && r.status === 200);
  check(!!reviewResp, `result review image HTTP 200 (${reviewSrc.split('/').pop()})`,
    reviewResp ? `${reviewResp.type} ${reviewResp.status}` : 'no successful response captured');
  const reviewRendered = await page.$$eval('img[src*="res.cloudinary.com"]', (els) => {
    const el = els[els.length - 1];
    return { complete: el.complete, w: el.naturalWidth };
  });
  check(reviewRendered.complete && reviewRendered.w > 0, 'review image actually decoded');

  await page.screenshot({ path: join(outDir, `${formFactor}-result-review.png`), fullPage: false });

  console.log(`\nscreenshots: ${outDir}\\${formFactor}-attempt-image-question.png, ${formFactor}-result-review.png`);
  console.log(allOk ? `${formFactor}: ALL IMAGE CHECKS PASSED` : `${formFactor}: IMAGE CHECKS FAILED`);
  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch((err) => {
  console.error('Harness crashed:', err.message);
  process.exit(1);
});
