/**
 * browser-freeman.js — Freeman Browser for AI Agents
 *
 * Stealth browser. Appears as iPhone 15 Pro or Desktop Chrome to every website.
 *
 * Usage:
 *   const { launchFreeman } = require('./browser-freeman');
 *   const { browser, page } = await launchFreeman({ mobile: true });
 */

const fs = require('fs');
const path = require('path');

// Polyfill fetch for Node.js < 18
if (!globalThis.fetch) {
  try {
    globalThis.fetch = require('node-fetch');
  } catch (_) {
    // node-fetch not installed, fetch will fail if used
  }
}

// ─── PLAYWRIGHT RESOLVER ──────────────────────────────────────────────────────

function _requirePlaywright() {
  const tries = [
    () => require('playwright'),
    () => require(path.resolve(process.cwd(), 'node_modules', 'playwright')),
    () => require(path.resolve(__dirname, '..', 'node_modules', 'playwright')),
    () => require(path.resolve(__dirname, '..', '..', 'playwright')),
    () => require(path.resolve(process.env.HOME || '/root', '.openclaw/workspace/node_modules/playwright'))
  ];
  for (const fn of tries) {
    try { return fn(); } catch (_) {}
  }
  throw new Error(
    '[freeman-browser] playwright not found.\n' +
    'Run: npm install playwright && npx playwright install chromium'
  );
}

const { chromium } = _requirePlaywright();

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

let userConfig = {};
try {
  const configPath = path.resolve(process.cwd(), process.env.BROWSER_CONFIG || 'browser.json');
  if (fs.existsSync(configPath)) {
    userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  console.warn('[freeman-browser] Could not load browser.json:', e.message);
}

// ─── CHROME VERSION DETECTION ─────────────────────────────────────────────────

let CHROME_VERSION = '136.0.0.0';
let CHROME_MAJOR = '136';

async function detectChromeVersion() {
  try {
    // Try to get the actual Chromium version from Playwright
    const browser = await chromium.launch({ headless: true });
    const version = browser.version(); // e.g., "136.0.7103.49 (Chromium)"
    await browser.close();
    
    const match = version.match(/Chromium\s+(\d+)\./);
    if (match) {
      CHROME_MAJOR = match[1];
      CHROME_VERSION = `${CHROME_MAJOR}.0.0.0`;
      console.log(`[freeman-browser] Detected Chromium ${CHROME_MAJOR}`);
    }
  } catch (err) {
    console.warn(`[freeman-browser] Could not detect Chromium version, using default ${CHROME_MAJOR}:`, err.message);
  }
}

// Detect version on module load (non-blocking)
detectChromeVersion().catch(() => {});

// ─── DEVICE PROFILES ─────────────────────────────────────────────────────────

function buildDevice(mobile) {
  const locale = userConfig.locale || 'en-US';
  const timezoneId = userConfig.timezoneId || 'America/New_York';
  const geolocation = userConfig.geolocation || { latitude: 40.7128, longitude: -74.006, accuracy: 50 };
  const acceptLanguage = locale + (locale === 'en-US' ? ',en;q=0.9' : ',en-US;q=0.9,en;q=0.8');

  if (mobile) {
    return {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale,
      timezoneId,
      geolocation,
      colorScheme: 'light',
      extraHTTPHeaders: {
        'Accept-Language': acceptLanguage,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-ch-ua': `"Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="99"`,
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"iOS"',
      },
    };
  }

  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`,
    viewport: { width: 1440, height: 900 },
    locale,
    timezoneId,
    geolocation,
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': acceptLanguage,
      'sec-ch-ua': `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  };
}

// ─── HUMAN BEHAVIOR ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ─── SLIDER CAPTCHA SOLVER ────────────────────────────────────────────────────

/**
 * Detect if the page contains a slider captcha (滑动验证)
 * @param {Page} page - Playwright page
 * @returns {Promise<Object|null>} - Slider info or null
 */
async function detectSliderCaptcha(page) {
  return page.evaluate(() => {
    // Common slider captcha indicators
    const indicators = [
      // Text indicators
      '滑动验证', '滑块验证', '请拖动滑块', '拖动滑块', '滑动解锁',
      '请完成安全验证', '安全验证', '人机验证', '验证码',
      // English
      'slide to verify', 'slider captcha', 'drag to verify', 'slide verify',
      // Xueqiu specific
      'nc_1__bg', 'nc_1__bar', 'nc_1__scale_text', 'nc_1_n1t',
      // Alibaba / Aliyun
      'bilibili-slider', 'yidun', 'geetest',
    ];

    const pageText = document.body?.innerText?.toLowerCase() || '';
    const pageHtml = document.documentElement?.innerHTML?.toLowerCase() || '';

    // Check for slider-related text
    const textMatch = indicators.some(ind =>
      pageText.includes(ind.toLowerCase()) ||
      pageHtml.includes(ind.toLowerCase())
    );

    // Check for slider-specific elements
    const sliderSelectors = [
      '.nc-container', '.nc_wrapper', '.yidun', '.geetest',
      '[class*="slider"]', '[class*="captcha"]', '[class*="verify"]', '[id*="slider"]', '[id*="captcha"]', '[id*="verify"]',
      '.bilibili-slider', '.nc_scale', '.btn_slide', '.slide-verify',
    ];

    let elementMatch = false;
    let matchedSelector = null;
    for (const sel of sliderSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          elementMatch = true;
          matchedSelector = sel;
          break;
        }
      } catch (_) {}
    }

    // Check for specific slider styles (width-based detection)
    // Only flag elements that are unambiguously sliders to reduce false positives
    const allElements = document.querySelectorAll('*');
    let styleMatch = false;
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // Must have move cursor AND be wide/narrow AND have visible background
      const hasMoveCursor = style.cursor === 'move' || style.cursor === 'grab' || style.cursor === 'grabbing';
      const isWideAndShort = rect.width > 200 && rect.height > 20 && rect.height < 80;
      const hasVisibleBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0,0,0,0)';
      // Also check for slider-related border-radius or overflow hidden
      const hasSliderStyle = style.borderRadius === '4px' || style.overflow === 'hidden' || style.overflowX === 'hidden';
      if (hasMoveCursor && isWideAndShort && (hasVisibleBg || hasSliderStyle)) {
        styleMatch = true;
        break;
      }
    }

    if (textMatch || elementMatch || styleMatch) {
      return {
        detected: true,
        textMatch,
        elementMatch,
        styleMatch,
        matchedSelector,
        url: window.location.href,
      };
    }
    return null;
  });
}

/**
 * Solve slider captcha by simulating human drag
 * @param {Page} page - Playwright page
 * @param {Object} opts - Options
 * @returns {Promise<boolean>} - Whether the captcha was solved
 */
async function solveSliderCaptcha(page, opts = {}) {
  const {
    maxRetries = 3,
    verbose = true,
  } = opts;

  const log = verbose ? (...a) => console.log('[slider-captcha]', ...a) : () => {};

  log('🔍 Detecting slider captcha...');

  // Wait a moment for the captcha to fully load
  await sleep(2000);

  // Try to find the slider track and handle
  const sliderInfo = await page.evaluate(() => {
    // Try multiple selectors for different slider implementations
    const selectors = {
      // Alibaba / Xueqiu style
      alibaba: {
        track: '.nc-container .nc_scale, .nc_scale, .btn_slide, .slide-verify-slider',
        handle: '.nc_iconfont.btn_slide, .nc_iconfont, .btn_slide, .slide-verify-block',
        text: '.nc_1__scale_text, .nc_1_n1t, .slide-verify-text',
      },
      // Geetest
      geetest: {
        track: '.geetest_slider_track, .geetest_track',
        handle: '.geetest_slider, .geetest_slider_button',
        text: '.geetest_tips, .geetest_text',
      },
      // Generic
      generic: {
        track: '[class*="slider"][class*="track"], [class*="slide"][class*="track"], .slider-track, .slide-track',
        handle: '[class*="slider"][class*="handle"], [class*="slide"][class*="block"], .slider-handle, .slide-block',
        text: '[class*="slider"][class*="text"], .slider-text, .slide-text',
      },
    };

    for (const [type, sel] of Object.entries(selectors)) {
      try {
        const track = document.querySelector(sel.track);
        const handle = document.querySelector(sel.handle);
        if (track || handle) {
          const trackRect = track ? track.getBoundingClientRect() : (handle ? handle.getBoundingClientRect() : null);
          const handleRect = handle ? handle.getBoundingClientRect() : trackRect;
          return {
            type,
            trackSelector: sel.track,
            handleSelector: sel.handle,
            textSelector: sel.text,
            trackRect: trackRect ? {
              x: trackRect.x, y: trackRect.y, width: trackRect.width, height: trackRect.height
            } : null,
            handleRect: handleRect ? {
              x: handleRect.x, y: handleRect.y, width: handleRect.width, height: handleRect.height
            } : null,
          };
        }
      } catch (_) {}
    }

    // Fallback: look for any element that looks like a slider
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      // Slider tracks are typically wide and short
      if (rect.width > 200 && rect.height < 80 && rect.height > 20) {
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
          return {
            type: 'fallback',
            trackSelector: null,
            handleSelector: null,
            trackRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            handleRect: { x: rect.x + 10, y: rect.y + 5, width: 40, height: rect.height - 10 },
          };
        }
      }
    }

    return null;
  });

  if (!sliderInfo) {
    log('❌ No slider captcha found');
    return false;
  }

  log('📍 Slider detected:', sliderInfo.type);
  if (sliderInfo.trackRect) {
    log(`   Track: ${JSON.stringify(sliderInfo.trackRect)}`);
  }
  if (sliderInfo.handleRect) {
    log(`   Handle: ${JSON.stringify(sliderInfo.handleRect)}`);
  }

  // Try to solve the slider
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    log(`🔄 Attempt ${attempt + 1}/${maxRetries}`);

    try {
      // Calculate positions
      const startX = sliderInfo.handleRect ? (sliderInfo.handleRect.x + sliderInfo.handleRect.width / 2) : (sliderInfo.trackRect.x + 30);
      const startY = sliderInfo.handleRect ? (sliderInfo.handleRect.y + sliderInfo.handleRect.height / 2) : (sliderInfo.trackRect.y + sliderInfo.trackRect.height / 2);
      const endX = sliderInfo.trackRect ? (sliderInfo.trackRect.x + sliderInfo.trackRect.width - 30) : (startX + 200);
      const endY = startY + rand(-5, 5); // Slight vertical variation

      log(`   Moving from (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(endX)}, ${Math.round(endY)})`);

      // First, move mouse to a random position near the handle (not directly on it)
      const hoverX = startX + rand(-20, 20);
      const hoverY = startY + rand(-20, 20);
      await page.mouse.move(hoverX, hoverY);
      await sleep(rand(300, 800));

      // Move to the handle slowly
      await page.mouse.move(startX, startY);
      await sleep(rand(200, 500));

      // Press down with slight delay
      await page.mouse.down();
      await sleep(rand(150, 400));

      // Calculate the distance to drag
      const distance = endX - startX;
      const steps = rand(30, 50);

      // Dynamic Bezier parameters based on drag distance
      // Short drags: flatter curve, less overshoot
      // Long drags: steeper curve, more natural acceleration profile
      const absDist = Math.abs(distance);
      const cp1x = absDist * (0.2 + Math.random() * 0.15);  // First control point X (20-35% of distance)
      const cp1y = (Math.random() - 0.5) * 20;              // First control point Y (slight vertical drift)
      const cp2x = absDist * (0.7 + Math.random() * 0.2);   // Second control point X (70-90% of distance)
      const cp2y = (Math.random() - 0.5) * 25;              // Second control point Y (more vertical drift at end)

      // Cubic Bezier evaluation
      function cubicBezier(t, p0, p1, p2, p3) {
        const mt = 1 - t;
        return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
      }

      // Human-like drag with acceleration and deceleration using dynamic Bezier
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;

        // Use Bezier curve for smooth acceleration/deceleration
        const easedT = cubicBezier(t, 0, cp1x / absDist, cp2x / absDist, 1);
        const currentX = startX + distance * easedT + rand(-3, 3);
        const currentY = startY + cubicBezier(t, 0, cp1y / 30, cp2y / 30, 0) * 3 + rand(-2, 2);
        await page.mouse.move(currentX, currentY);

        // Variable delay with occasional pauses
        let delay;
        const speed = Math.abs(easedT - (i > 0 ? cubicBezier((i-1)/steps, 0, cp1x/absDist, cp2x/absDist, 1) : 0));
        if (speed < 0.02) {
          delay = rand(40, 80); // Slower at inflection points
        } else if (t < 0.15 || t > 0.85) {
          delay = rand(25, 50); // Slower at edges
        } else {
          delay = rand(10, 25); // Fast in middle
        }

        // Random pause (3% chance)
        if (Math.random() < 0.03) {
          delay += rand(80, 200);
        }

        await sleep(delay);
      }

      // Small back-and-forth at the end (human behavior)
      await page.mouse.move(endX - rand(5, 15), endY + rand(-2, 2));
      await sleep(rand(50, 150));
      await page.mouse.move(endX, endY);
      await sleep(rand(100, 300));

      // Release
      await page.mouse.up();
      await sleep(rand(800, 2000));

      // Check if the captcha is solved
      await sleep(4000);

      const isSolved = await page.evaluate(() => {
        // Check for success indicators
        const successTexts = ['验证成功', '验证通过', 'success', 'verified', '通过', '完成'];
        const pageText = document.body?.innerText?.toLowerCase() || '';
        const hasSuccessText = successTexts.some(t => pageText.includes(t.toLowerCase()));

        // Check if the slider is still present
        const sliderSelectors = [
          '.nc-container', '.nc_scale', '.btn_slide', '.geetest_slider',
          '[class*="slider"]', '[class*="captcha"]', '[id*="slider"]',
          '.slide-verify', '.yidun', '.geetest'
        ];
        let sliderStillPresent = false;
        for (const sel of sliderSelectors) {
          try {
            if (document.querySelector(sel)) {
              sliderStillPresent = true;
              break;
            }
          } catch (_) {}
        }

        // Check for error/retry indicators
        const errorTexts = ['验证失败', '请重试', 'try again', 'failed', '错误', 'error'];
        const hasError = errorTexts.some(t => pageText.includes(t.toLowerCase()));

        // Check if page content loaded (article text present)
        const contentSelectors = ['article', '#js_content', '.rich_media_content', '.article-content', '#content'];
        let hasContent = false;
        for (const sel of contentSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 200) {
              hasContent = true;
              break;
            }
          } catch (_) {}
        }

        return {
          solved: !sliderStillPresent || hasSuccessText || hasContent,
          hasError,
          hasContent,
          pageText: pageText.slice(0, 200),
        };
      });

      log(`   Result:`, isSolved);

      // If we have content, the captcha is solved regardless of error text
      if (isSolved.hasContent) {
        log('✅ Page content loaded, slider captcha solved!');
        return true;
      }

      if (isSolved.solved && !isSolved.hasError) {
        log('✅ Slider captcha solved!');
        return true;
      }

      if (isSolved.hasError && !isSolved.hasContent) {
        log('   Error detected, will retry...');
        // Wait before retry
        await sleep(rand(3000, 5000));
      }

    } catch (err) {
      log(`   Error during attempt: ${err.message}`);
    }
  }

  log('❌ Failed to solve slider captcha after all retries');
  return false;
}

/**
 * Wait for and handle slider captcha on the page
 * @param {Page} page - Playwright page
 * @param {Object} opts - Options
 * @returns {Promise<boolean>} - Whether a slider was detected and solved
 */
async function handleSliderCaptcha(page, opts = {}) {
  const {
    timeout = 10000,
    checkInterval = 1000,
    verbose = true,
  } = opts;

  const log = verbose ? (...a) => console.log('[slider-captcha]', ...a) : () => {};
  const startTime = Date.now();

  log('👀 Watching for slider captcha...');

  while (Date.now() - startTime < timeout) {
    const detected = await detectSliderCaptcha(page);
    if (detected) {
      log('🚨 Slider captcha detected!');
      const result = await solveSliderCaptcha(page, opts);
      return result;
    }
    await sleep(checkInterval);
  }

  log('⏱️ No slider captcha detected within timeout');
  return false;
}

async function humanMouseMove(page, toX, toY, fromX = null, fromY = null) {
  const startX = fromX ?? rand(100, 300);
  const startY = fromY ?? rand(200, 600);
  const cp1x = startX + rand(-80, 80), cp1y = startY + rand(-60, 60);
  const cp2x = toX   + rand(-50, 50), cp2y = toY   + rand(-40, 40);
  const steps = rand(12, 25);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(Math.pow(1-t,3)*startX + 3*Math.pow(1-t,2)*t*cp1x + 3*(1-t)*t*t*cp2x + t*t*t*toX);
    const y = Math.round(Math.pow(1-t,3)*startY + 3*Math.pow(1-t,2)*t*cp1y + 3*(1-t)*t*t*cp2y + t*t*t*toY);
    await page.mouse.move(x, y);
    await sleep(t < 0.2 || t > 0.8 ? rand(8, 20) : rand(2, 8));
  }
}

async function humanClick(page, x, y) {
  await humanMouseMove(page, x, y);
  await sleep(rand(50, 180));
  await page.mouse.down();
  await sleep(rand(40, 100));
  await page.mouse.up();
  await sleep(rand(100, 300));
}

async function humanType(page, selector, text) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  const box = await el.boundingBox();
  if (box) await humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(rand(200, 500));
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(rand(60, 220));
    if (Math.random() < 0.08) await sleep(rand(400, 900));
  }
  await sleep(rand(200, 400));
}

async function humanScroll(page, direction = 'down', amount = null) {
  const scrollAmount = amount || rand(200, 600);
  const delta = direction === 'down' ? scrollAmount : -scrollAmount;
  const vp = page.viewportSize();
  await humanMouseMove(page, rand(100, vp.width - 100), rand(200, vp.height - 200));
  const steps = rand(4, 10);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta / steps + rand(-5, 5));
    await sleep(rand(30, 80));
  }
  await sleep(rand(200, 800));
}

async function humanRead(page, minMs = 1500, maxMs = 4000) {
  await sleep(rand(minMs, maxMs));
  if (Math.random() < 0.3) await humanScroll(page, 'down', rand(50, 150));
}

// ─── 2CAPTCHA SOLVER ──────────────────────────────────────────────────────────

async function solveCaptcha(page, opts = {}) {
  const {
    apiKey   = process.env.TWOCAPTCHA_KEY,
    action   = 'verify',
    minScore = 0.7,
    timeout  = 120000,
    verbose  = false,
  } = opts;

  if (!apiKey) throw new Error('[2captcha] No API key. Set TWOCAPTCHA_KEY env or pass opts.apiKey');

  const log = verbose ? (...a) => console.log('[2captcha]', ...a) : () => {};
  const pageUrl = page.url();

  const detected = await page.evaluate(() => {
    const rc = document.querySelector('.g-recaptcha, [data-sitekey]');
    if (rc) {
      const sitekey = rc.getAttribute('data-sitekey') || rc.getAttribute('data-key');
      const version = rc.getAttribute('data-version') || (typeof window.grecaptcha !== 'undefined' && 'v2');
      return { type: 'recaptcha', sitekey, version: version === 'v3' ? 'v3' : 'v2' };
    }
    const hc = document.querySelector('.h-captcha, [data-hcaptcha-sitekey]');
    if (hc) return { type: 'hcaptcha', sitekey: hc.getAttribute('data-sitekey') || hc.getAttribute('data-hcaptcha-sitekey') };
    const ts = document.querySelector('.cf-turnstile, [data-cf-turnstile-sitekey]');
    if (ts) return { type: 'turnstile', sitekey: ts.getAttribute('data-sitekey') || ts.getAttribute('data-cf-turnstile-sitekey') };
    const scripts = [...document.scripts].map(s => s.src + s.textContent).join(' ');
    const rcMatch = scripts.match(/(?:sitekey|data-sitekey)['":\s]+([A-Za-z0-9_-]{40,})/);
    if (rcMatch) return { type: 'recaptcha', sitekey: rcMatch[1], version: 'v2' };
    return null;
  });

  if (!detected || !detected.sitekey) throw new Error('[2captcha] No captcha detected on page.');
  log(`Detected ${detected.type} v${detected.version || ''}`, detected.sitekey.slice(0, 20) + '...');

  let submitUrl = `https://2captcha.com/in.php?key=${apiKey}&json=1&pageurl=${encodeURIComponent(pageUrl)}&googlekey=${encodeURIComponent(detected.sitekey)}`;
  if (detected.type === 'recaptcha') {
    submitUrl += `&method=userrecaptcha`;
    if (detected.version === 'v3') submitUrl += `&version=v3&action=${action}&min_score=${minScore}`;
  } else if (detected.type === 'hcaptcha') {
    submitUrl += `&method=hcaptcha&sitekey=${encodeURIComponent(detected.sitekey)}`;
  } else if (detected.type === 'turnstile') {
    submitUrl += `&method=turnstile&sitekey=${encodeURIComponent(detected.sitekey)}`;
  }

  const submitResp = await fetch(submitUrl);
  const submitData = await submitResp.json();
  if (!submitData.status || submitData.status !== 1) throw new Error(`[2captcha] Submit failed: ${JSON.stringify(submitData)}`);
  const taskId = submitData.request;
  log(`Task submitted: ${taskId} — waiting for workers...`);

  let token = null;
  const maxAttempts = Math.floor(timeout / 5000);
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(i === 0 ? 15000 : 5000);
    const pollResp = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`);
    const pollData = await pollResp.json();
    if (pollData.status === 1) { token = pollData.request; log('✅ Solved!'); break; }
    if (pollData.request !== 'CAPCHA_NOT_READY' && pollData.request !== 'CAPTCHA_NOT_READY') throw new Error(`[2captcha] Poll error: ${JSON.stringify(pollData)}`);
    log(`⏳ Attempt ${i + 1}/${maxAttempts}...`);
  }
  if (!token) throw new Error('[2captcha] Timeout waiting for captcha solution');

  await page.evaluate(({ type, token }) => {
    if (type === 'recaptcha' || type === 'turnstile') {
      const ta = document.querySelector('#g-recaptcha-response, [name="g-recaptcha-response"]');
      if (ta) { ta.style.display = 'block'; ta.value = token; ta.dispatchEvent(new Event('change', { bubbles: true })); }
      try {
        const clients = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
        if (clients) Object.values(clients).forEach(c => Object.values(c).forEach(w => { if (w && typeof w.callback === 'function') w.callback(token); }));
      } catch (_) {}
    }
    if (type === 'hcaptcha') {
      const ta = document.querySelector('[name="h-captcha-response"], #h-captcha-response');
      if (ta) { ta.style.display = 'block'; ta.value = token; ta.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    if (type === 'turnstile') {
      const inp = document.querySelector('[name="cf-turnstile-response"]');
      if (inp) { inp.value = token; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }, { type: detected.type, token });

  log('✅ Token injected');
  return { token, type: detected.type, sitekey: detected.sitekey };
}

// ─── LAUNCH ───────────────────────────────────────────────────────────────────

async function launchFreeman(opts = {}) {
  const {
    mobile   = true,
    headless = true,
  } = opts;

  const device = buildDevice(mobile);

  // Dynamically resolve Playwright browser executable
  let browserPath = undefined;
  try {
    const { registryDirectory, executables } = _requirePlaywright()._impl || {};
    if (registryDirectory && executables) {
      // Playwright internal resolution — most reliable
      const chromiumEntry = executables.find(e => e.name === 'chromium');
      if (chromiumEntry && registryDirectory) {
        browserPath = chromiumEntry.executablePath(registryDirectory);
      }
    }
  } catch (_) {}
  // Fallback: scan common ms-playwright directories
  if (!browserPath) {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
      path.join(process.env.HOME || '/root', '.cache', 'ms-playwright'),
    ];
    for (const base of candidates) {
      try {
        if (!fs.existsSync(base)) continue;
        const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium-')).sort();
        if (dirs.length === 0) continue;
        // Pick the latest chromium version directory
        const latestDir = dirs[dirs.length - 1];
        const exe = path.join(base, latestDir, 'chrome-win64', 'chrome.exe');
        const exeLinux = path.join(base, latestDir, 'chrome-linux', 'chrome');
        if (fs.existsSync(exe)) { browserPath = exe; break; }
        if (fs.existsSync(exeLinux)) { browserPath = exeLinux; break; }
      } catch (_) {}
    }
  }

  // Enhanced Chromium args for better stealth and stability
  const BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font']; // block by default, override per-site
  const browser = await chromium.launch({
    headless,
    executablePath: browserPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-client-side-phishing-detection',
      '--disable-component-extensions-with-background-pages',
      '--disable-infobars',
      '--disable-session-crashed-bubble',
      '--disable-smooth-scrolling',
      '--disable-print-preview',
      '--disable-speech-api',
      '--disable-voice-input',
      '--disable-wake-on-wifi',
      '--disable-cast',
      '--disable-hang-monitor',
      '--disable-delay-unsupported-metrics-reporting',
      '--disable-domain-reliability',
      '--disable-features=AudioServiceOutOfProcess',
      '--disable-logging',
      '--disable-message-center-alerts',
      '--disable-metrics-reporting',
      '--disable-notifications',
      '--disable-password-generation',
      '--disable-password-manager-reauthentication',
      '--disable-permission-event-reporting',
      '--disable-presentation-api',
      '--disable-remote-fonts',
      '--disable-screen-capture',
      '--disable-share',
      '--disable-speech-dispatcher',
      '--disable-spellchecking',
      '--disable-subscription-messaging',
      '--disable-system-font-check',
      '--disable-threaded-animation',
      '--disable-threaded-scrolling',
      '--disable-url-keyed-animated-content',
      '--disable-usb-keyboard-detect',
      '--disable-windows10-custom-titlebar',
      '--disable-xss-auditor',
      '--dns-over-https-templates=https://dns.google/dns-query,https://cloudflare-dns.com/dns-query',
    ],
  });

  const ctxOpts = {
    ...device,
    ignoreHTTPSErrors: true,
    permissions: ['geolocation', 'notifications'],
    proxy: userConfig.proxy ? {
      server: userConfig.proxy.server,
      bypass: userConfig.proxy.bypass || [],
      username: userConfig.proxy.username,
      password: userConfig.proxy.password,
    } : undefined,
  };

  const ctx = await browser.newContext(ctxOpts);

  // Route to block trackers, ads, and unnecessary resources
  const TRACKER_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'googletagmanager.com', 'googletagservices.com', 'google-analytics.com',
    'googleanalytics.com', 'googleoptimize.com', 'facebook.com/tr',
    'connect.facebook.net', 'pixel.facebook.com', 'analytics.twitter.com',
    'static.hotjar.com', 'static.ads-twitter.com', 'ads.twitter.com',
    'bat.bing.com', 'c.bing.com', 'snap.licdn.com', 'ads.linkedin.com',
    'analytics.linkedin.com', 'pixel.tapad.com', 'pixel.rubiconproject.com',
    'ads.rubiconproject.com', 'cm.g.doubleclick.net',
    'securepubads.g.doubleclick.net', 'pagead2.googlesyndication.com',
    'tpc.googlesyndication.com', 'syndication.twitter.com',
    'platform.twitter.com', 'static.adsafeprotected.com', 'fw.adsafeprotected.com',
    'js-agent.newrelic.com', 'bam.nr-data.net', 'nr-data.net',
    'sc.analytics.yahoo.com', 'analytics.yahoo.com', 'pixel.tree.com',
    'pixel.advertising.com', 'ads.pubmatic.com', 'ads.yahoo.com',
    'adservice.google.com', 'adservice.google.com',
    'static.criteo.net', 'static.criteo.com', 'bidgear.com',
    'moatads.com', 'adsafeprotected.com', 'imasdk.googleapis.com',
    'imasdk.cdn.fireeye.com', 'analytics.srvtrk.com',
  ];

  await ctx.route('**/*', async (route, request) => {
    const url = request.url();
    const resourceType = request.resourceType();
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const isTracker = TRACKER_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
      if (isTracker) {
        return route.abort();
      }
      // Block fonts/media by default for stealth (saves fingerprint surface)
      if (resourceType === 'font' || resourceType === 'media') {
        return route.abort();
      }
    } catch (_) {
      // ignore URL parse errors
    }
    return route.continue();
  });

  // Enhanced anti-detection: override navigator properties
  await ctx.addInitScript((m) => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver',           { get: () => false });
    Object.defineProperty(navigator, 'maxTouchPoints',      { get: () => m.mobile ? 5 : 0 });
    Object.defineProperty(navigator, 'platform',            { get: () => m.mobile ? 'iPhone' : 'Win32' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => m.mobile ? 6 : 8 });
    Object.defineProperty(navigator, 'language',            { get: () => m.locale });
    Object.defineProperty(navigator, 'languages',           { get: () => [m.locale, 'en'] });
    Object.defineProperty(navigator, 'deviceMemory',        { get: () => m.mobile ? 4 : 8 });
    Object.defineProperty(navigator, 'vendor',              { get: () => m.mobile ? 'Apple Computer, Inc.' : 'Google Inc.' });
    Object.defineProperty(navigator, 'doNotTrack',          { get: () => '1' });
    Object.defineProperty(navigator, 'cookieEnabled',       { get: () => true });
    Object.defineProperty(navigator, 'appCodeName',         { get: () => 'Mozilla' });
    Object.defineProperty(navigator, 'appName',             { get: () => 'Netscape' });
    Object.defineProperty(navigator, 'appVersion',          { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' });
    Object.defineProperty(navigator, 'product',             { get: () => 'Gecko' });
    Object.defineProperty(navigator, 'productSub',          { get: () => '20030107' });
    Object.defineProperty(navigator, 'vendorSub',           { get: () => '' });
    Object.defineProperty(navigator, 'buildID',             { get: () => undefined });
    Object.defineProperty(navigator, 'maxTouchPoints',      { get: () => m.mobile ? 5 : 0 });
    Object.defineProperty(navigator, 'pdfViewerEnabled',    { get: () => true });

    // Override permissions
    if (navigator.permissions) {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = async (parameters) => {
        if (['notifications', 'clipboard-read', 'clipboard-write', 'geolocation', 'camera', 'microphone'].includes(parameters.name)) {
          return { state: 'prompt', onchange: null };
        }
        return originalQuery.call(navigator.permissions, parameters);
      };
    }

    // Override plugins to appear as real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [];
        const pluginNames = m.mobile
          ? ['Mobile PDF Plugin', 'Mobile PDF Viewer', 'Native Client']
          : ['Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client'];
        const pluginFiles = ['internal-pdf-viewer', 'internal-pdf-viewer', 'internal-nacl-plugin'];
        const pluginDescs = ['Portable Document Format', 'Portable Document Format', ''];
        for (let i = 0; i < 3; i++) {
          plugins.push({
            name: pluginNames[i],
            filename: pluginFiles[i],
            description: pluginDescs[i],
            version: undefined,
            length: 0,
            item: () => null,
            namedItem: () => null,
          });
        }
        return plugins;
      }
    });

    // Override mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mimes = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null },
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null },
        ];
        if (m.mobile) {
          mimes.push({ type: 'application/x-nacl', suffixes: '', description: 'Native Client', enabledPlugin: null });
        }
        return mimes;
      }
    });

    // Screen properties
    if (m.mobile) {
      Object.defineProperty(screen, 'width',       { get: () => 393 });
      Object.defineProperty(screen, 'height',      { get: () => 852 });
      Object.defineProperty(screen, 'availWidth',  { get: () => 393 });
      Object.defineProperty(screen, 'availHeight', { get: () => 852 });
      Object.defineProperty(screen, 'colorDepth',  { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth',  { get: () => 24 });
      Object.defineProperty(screen, 'orientation', { get: () => ({ type: 'portraitPrimary', angle: 0 }) });
    } else {
      Object.defineProperty(screen, 'width',       { get: () => 1440 });
      Object.defineProperty(screen, 'height',      { get: () => 900 });
      Object.defineProperty(screen, 'availWidth',  { get: () => 1440 });
      Object.defineProperty(screen, 'availHeight', { get: () => 860 });
      Object.defineProperty(screen, 'colorDepth',  { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth',  { get: () => 24 });
      Object.defineProperty(screen, 'orientation', { get: () => ({ type: 'landscapePrimary', angle: 0 }) });
    }

    // Connection
    if (navigator.connection) {
      try {
        Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
        Object.defineProperty(navigator.connection, 'downlink',      { get: () => 10 });
        Object.defineProperty(navigator.connection, 'rtt',           { get: () => 50 });
        Object.defineProperty(navigator.connection, 'saveData',      { get: () => false });
      } catch (_) {}
    }

    // Canvas & WebGL fingerprint randomization (single override)
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const context = originalGetContext.call(this, type, ...args);
      if (context && type === '2d') {
        const originalFillText = context.fillText;
        context.fillText = function(...textArgs) {
          // Slightly shift text position to break static fingerprint
          if (textArgs.length >= 1) {
            const offsetX = (Math.random() - 0.5) * 0.4;
            const offsetY = (Math.random() - 0.5) * 0.4;
            this.translate(offsetX, offsetY);
            const result = originalFillText.apply(this, textArgs);
            this.translate(-offsetX, -offsetY);
            return result;
          }
          return originalFillText.apply(this, textArgs);
        };
        // Randomize getImageData slightly
        const originalGetImageData = context.getImageData;
        context.getImageData = function(...args) {
          const imageData = originalGetImageData.apply(this, args);
          // Flip a few random pixels (max 2)
          const count = Math.floor(Math.random() * 2) + 1;
          for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * imageData.data.length / 4) * 4;
            imageData.data[idx] = imageData.data[idx] ^ 1;
          }
          return imageData;
        };
      }
      if (context && (type === 'webgl' || type === 'experimental-webgl')) {
        const getParameter = context.getParameter.bind(context);
        context.getParameter = function(parameter) {
          // Return common values to blend in
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          if (parameter === 37447) return 'Intel Open Source Technology Center';
          return getParameter(parameter);
        };
      }
      return context;
    };

    // Override Notification API
    if (window.Notification) {
      Object.defineProperty(window.Notification, 'permission', { get: () => 'default' });
    }

    // Override Chrome-specific APIs
    if (window.chrome) {
      Object.defineProperty(window.chrome, 'runtime', {
        get: () => ({
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', UPDATE: 'update', INSTALL: 'install' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        })
      });
      // Add more chrome APIs commonly checked
      Object.defineProperty(window.chrome, 'csi', { get: () => () => {} });
      Object.defineProperty(window.chrome, 'loadTimes', { get: () => () => {} });
    }

    // Override toDataURL to inject slight noise into canvas fingerprint
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const ctx2d = originalGetContext ? originalGetContext.call(this, '2d') : null;
      if (ctx2d && this.width > 16 && this.height > 16) {
        try {
          const imageData = ctx2d.getImageData(0, 0, this.width, this.height);
          const data = imageData.data;
          // Flip a few random pixels (max 3) to make each call unique
          const count = Math.floor(Math.random() * 3) + 1;
          for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * data.length / 4) * 4;
            data[idx] = data[idx] ^ 1; // flip LSB of R
          }
          ctx2d.putImageData(imageData, 0, 0);
        } catch (_) {}
      }
      return originalToDataURL.apply(this, args);
    };

    // Override WebRTC to prevent IP leak (without breaking functionality)
    if (window.RTCPeerConnection) {
      const originalCreateDataChannel = window.RTCPeerConnection.prototype.createDataChannel;
      window.RTCPeerConnection.prototype.createDataChannel = function(...args) {
        const channel = originalCreateDataChannel.apply(this, args);
        // Override onopen to delay and add noise
        const originalOnOpen = channel.onopen;
        channel.onopen = function(event) {
          if (originalOnOpen) originalOnOpen.call(this, event);
        };
        return channel;
      };
    }

    // Override navigator.getBattery (often used for fingerprinting)
    if (navigator.getBattery) {
      navigator.getBattery = async () => ({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
        addEventListener: () => {},
        removeEventListener: () => {},
      });
    }

    // Override media devices
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => {
        const devices = await originalEnumerateDevices();
        return devices.map((d, i) => ({
          ...d,
          deviceId: d.deviceId || `device-${i}`,
          groupId: d.groupId || `group-${i}`,
        }));
      };
    }

    // Prevent detection via timing attacks
    const originalPerformanceNow = performance.now.bind(performance);
    performance.now = function() {
      const now = originalPerformanceNow();
      // Add small jitter (max 0.1ms) to timing measurements
      return now + (Math.random() - 0.5) * 0.1;
    };

    // Override Date to prevent timing fingerprinting
    const originalDateNow = Date.now.bind(Date);
    Date.now = function() {
      return originalDateNow() + Math.floor((Math.random() - 0.5) * 2);
    };

  }, { mobile, locale: device.locale });

  // Add additional headers to avoid detection
  await ctx.setExtraHTTPHeaders({
    'Accept-Language': device.locale + (device.locale === 'en-US' ? ',en;q=0.9' : ',en-US;q=0.9,en;q=0.8'),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Sec-CH-UA': `"Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="99", "Google Chrome";v="${CHROME_MAJOR}"`,
    'Sec-CH-UA-Mobile': mobile ? '?1' : '?0',
    'Sec-CH-UA-Platform': mobile ? '"iOS"' : '"Windows"',
    'Priority': 'u=0, i',
  });

  const page = await ctx.newPage();

  // Add slider captcha detection and handling
  page.handleSliderCaptcha = (opts) => handleSliderCaptcha(page, opts);
  page.detectSliderCaptcha = () => detectSliderCaptcha(page);
  page.solveSliderCaptcha = (opts) => solveSliderCaptcha(page, opts);

  return { browser, ctx, page, humanClick, humanMouseMove, humanType, humanScroll, humanRead, sleep, rand };
}

// ─── SMART NAVIGATION WITH RETRY ──────────────────────────────────────────────

/**
 * Navigate to a URL with automatic retry on failure.
 * @param {Page} page - Playwright page
 * @param {string} url - URL to navigate to
 * @param {Object} opts - Options
 * @returns {Promise<void>}
 */
async function smartNavigate(page, url, opts = {}) {
  const { timeout = 60000, retries = 2, waitUntil = 'auto' } = opts;
  const lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(rand(2000, 5000));
      }

      // Determine waitUntil strategy
      let currentWaitUntil = waitUntil;
      if (waitUntil === 'auto') {
        // First attempt: try domcontentloaded (fast)
        // If retry is needed, fall back to networkidle for SPA-like pages
        currentWaitUntil = attempt === 0 ? 'domcontentloaded' : 'networkidle';
      }

      await page.goto(url, { waitUntil: currentWaitUntil, timeout });
      
      // If using auto strategy and domcontentloaded succeeded, do a quick content check
      // to see if the page looks fully loaded or needs networkidle
      if (waitUntil === 'auto' && currentWaitUntil === 'domcontentloaded' && attempt === 0) {
        await sleep(2000);
        const pageInfo = await page.evaluate(() => {
          const bodyLen = document.body?.innerText?.trim().length || 0;
          const imgCount = document.querySelectorAll('img').length;
          const hasLoadingIndicators = document.querySelectorAll('.loading, .spinner, [data-loading], .loading-spinner').length;
          return { bodyLen, imgCount, hasLoadingIndicators };
        });

        // If page has very little content and has images or loading indicators, 
        // it's likely an SPA that needs networkidle
        if (pageInfo.bodyLen < 500 && (pageInfo.imgCount > 0 || pageInfo.hasLoadingIndicators > 0)) {
          log?.(`[smartNavigate] Page looks incomplete (${pageInfo.bodyLen} chars, ${pageInfo.imgCount} imgs), retrying with networkidle...`);
          throw new Error('Incomplete page load, retrying with networkidle');
        }
      }
      
      return;
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Navigation failed after ${retries + 1} attempts: ${err.message}`);
      }
      // Check if we need to handle a captcha or error page
      const pageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || '');
      if (pageText.includes('captcha') || pageText.includes('验证') || pageText.includes('slider')) {
        // Try to handle captcha
        const detected = await detectSliderCaptcha(page);
        if (detected) {
          await solveSliderCaptcha(page, { maxRetries: 2 });
          await sleep(3000);
          continue;
        }
      }
    }
  }
}

// ─── SHADOW DOM UTILITIES ─────────────────────────────────────────────────────

async function shadowQuery(page, selector) {
  return page.evaluate((sel) => {
    function q(root, s) {
      const el = root.querySelector(s); if (el) return el;
      for (const n of root.querySelectorAll('*')) if (n.shadowRoot) { const f = q(n.shadowRoot, s); if (f) return f; }
    }
    return q(document, sel);
  }, selector);
}

async function shadowFill(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    function q(root, s) {
      const el = root.querySelector(s); if (el) return el;
      for (const n of root.querySelectorAll('*')) if (n.shadowRoot) { const f = q(n.shadowRoot, s); if (f) return f; }
    }
    const el = q(document, sel);
    if (!el) throw new Error('shadowFill: not found: ' + sel);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function shadowClickButton(page, buttonText) {
  await page.evaluate((text) => {
    function find(root) {
      for (const b of root.querySelectorAll('button')) if (b.textContent.trim() === text) return b;
      for (const n of root.querySelectorAll('*')) if (n.shadowRoot) { const f = find(n.shadowRoot); if (f) return f; }
    }
    const btn = find(document);
    if (!btn) throw new Error('shadowClickButton: not found: ' + text);
    btn.click();
  }, buttonText);
}

async function dumpInteractiveElements(page) {
  return page.evaluate(() => {
    const res = [];
    function collect(root) {
      for (const el of root.querySelectorAll('input,textarea,button,select,[contenteditable]')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0)
          res.push({ tag: el.tagName, name: el.name || '', id: el.id || '', type: el.type || '', text: el.textContent?.trim().slice(0, 25) || '', placeholder: el.placeholder?.slice(0, 25) || '' });
      }
      for (const n of root.querySelectorAll('*')) if (n.shadowRoot) collect(n.shadowRoot);
    }
    collect(document);
    return res;
  });
}

// ─── RICH TEXT EDITOR UTILITIES ───────────────────────────────────────────────

async function pasteIntoEditor(page, editorSelector, text) {
  const el = await page.$(editorSelector);
  if (!el) throw new Error('pasteIntoEditor: editor not found: ' + editorSelector);
  await el.click();
  await sleep(300);
  await page.evaluate((t) => {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }, text);
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+a`);
  await sleep(100);
  await page.keyboard.press(`${modifier}+v`);
  await sleep(500);
}

// ─── RETRY EXTRACTION HELPER ───────────────────────────────────────────────────
/**
 * Shared retry wrapper for article extraction.
 * Runs `attemptFn` up to `retries + 1` times, with backoff between attempts.
 * Each attempt should return `{ articleData, contentReady }` or throw.
 * If extraction is incomplete but data exists, returns `{ partial: true }`.
 *
 * @param {Object} opts
 * @param {Function} opts.log - logger
 * @param {string} opts.label - fetcher name for logs
 * @param {Page} opts.page - Playwright page
 * @param {number} opts.retries - max retry attempts after first failure
 * @param {Function} opts.attemptFn - async function returning { articleData, contentReady }
 * @returns {Promise<Object>} result object
 */
async function retryExtract({ log, label, page, retries = 2, attemptFn }) {
  let lastArticleData = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      log(`🔄 [${label}] Retry attempt ${attempt + 1}/${retries + 1}...`);
      await sleep(rand(3000, 6000));
    }

    let articleData = null;
    let contentReady = false;

    try {
      const result = await attemptFn({ attempt, page });
      articleData = result.articleData;
      contentReady = result.contentReady;
    } catch (err) {
      log(`❌ [${label}] Attempt ${attempt + 1} threw: ${err.message}`);
      if (attempt >= retries) throw err;
      continue;
    }

    const hasTitle = articleData && articleData.title && articleData.title.length > 0;
    const hasContent = articleData && articleData.textContent && articleData.textContent.length > 100;
    log(`   [${label}] Extracted: title="${articleData?.title?.slice(0, 50) || 'N/A'}", content=${articleData?.textContent?.length || 0} chars`);

    if (hasTitle && hasContent) {
      log(`✅ [${label}] Article extracted successfully`);
      return { success: true, data: articleData, partial: false };
    }

    lastArticleData = articleData;

    if (contentReady) {
      log(`⚠️ [${label}] Content ready but extraction incomplete`);
    } else {
      log(`⚠️ [${label}] Content not ready after attempt ${attempt + 1}`);
    }

    if (attempt >= retries) {
      log(`❌ [${label}] Extraction failed after all retries`);
      break;
    }
  }

  if (lastArticleData) {
    log(`⚠️ [${label}] Returning partial article data`);
    return { success: true, data: lastArticleData, partial: true };
  }

  throw new Error(`[${label}] Failed to extract article after all retries`);
}

/**
 * Shared browser lifecycle helper.
 * Launches browser, sets viewport, injects init scripts, runs work, and closes browser.
 *
 * @param {Object} opts
 * @param {Object} opts.launchOpts - options passed to launchFreeman
 * @param {Array<Function>} opts.initScripts - init scripts to inject
 * @param {Function} opts.work - async function receiving page
 * @param {Function} opts.log - logger
 * @returns {Promise<*>} result of work(page)
 */
async function withBrowser({ launchOpts, initScripts = [], work, log }) {
  const { browser, page } = await launchFreeman(launchOpts);

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const script of initScripts) {
      await page.addInitScript(script);
    }
    return await work(page);
  } catch (error) {
    log('❌ Error fetching article:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
    log('🔒 Browser closed');
  }
}

// ─── XUEQIU ARTICLE FETCHER ───────────────────────────────────────────────────

/**
 * Fetch a Xueqiu article with automatic slider captcha handling
 * Supports both HTML page scraping and API direct access (when available)
 * @param {string} articleUrl - The Xueqiu article URL
 * @param {Object} opts - Options
 * @returns {Promise<Object>} - Article data
 */
async function fetchXueqiuArticle(articleUrl, opts = {}) {
  const {
    headless = true,
    verbose = true,
    timeout = 60000,
    waitForContent = true,
  } = opts;

  const log = verbose ? (...a) => console.log('[xueqiu]', ...a) : () => {};

  log('🚀 Launching Freeman Browser for Xueqiu...');
  log(`🔗 URL: ${articleUrl}`);

  return withBrowser({
    launchOpts: { mobile: false, headless },
    initScripts: [
      () => {
        const originalRTCPeerConnection = window.RTCPeerConnection;
        if (originalRTCPeerConnection) {
          window.RTCPeerConnection = function(...args) {
            const pc = new originalRTCPeerConnection(...args);
            const originalCreateDataChannel = pc.createDataChannel.bind(pc);
            pc.createDataChannel = function(...dcArgs) {
              return originalCreateDataChannel(...dcArgs);
            };
            return pc;
          };
        }
      },
    ],
    work: async (page) => {
      // Try API direct access first (more reliable, less likely to be blocked)
      const apiResult = await _tryXueqiuApi(page, articleUrl, log);
      if (apiResult) {
        return apiResult;
      }

      // Use shared retry wrapper for HTML fallback
      const result = await retryExtract({
        log,
        label: 'xueqiu',
        page,
        retries: 2,
        attemptFn: async ({ attempt, page }) => {
          // Fallback to HTML scraping
          log('📡 Navigating to article (HTML fallback)...');
          await smartNavigate(page, articleUrl, { timeout, waitUntil: 'auto' });

          // Wait for initial load
          await sleep(3000 + attempt * 1000);

          // Check for slider captcha
          log('🔍 Checking for slider captcha...');
          const sliderDetected = await detectSliderCaptcha(page);

          if (sliderDetected) {
            log('🚨 Slider captcha detected, attempting to solve...');
            const solved = await solveSliderCaptcha(page, { verbose, maxRetries: 3 });
            if (!solved) {
              log('❌ Failed to solve slider captcha');
              try {
                await page.screenshot({ path: 'xueqiu_slider_failed.png' });
                log('📸 Screenshot saved to xueqiu_slider_failed.png');
              } catch (_) {}
              throw new Error('Slider captcha could not be solved');
            }
            log('✅ Slider captcha solved!');
            await sleep(5000 + attempt * 1000);
          }

          // Wait for article content to load
          let contentReady = false;
          if (waitForContent) {
            log('⏳ Waiting for article content...');
            try {
              await page.waitForSelector('article, .article-content, .article__content, .content, [class*="article"], .status-content, .article__bd', {
                timeout: 30000,
                state: 'attached',
              });
              const textLen = await page.evaluate(() => {
                const el = document.querySelector('article, .article-content, .article__content, .content, [class*="article"], .status-content, .article__bd');
                return el ? el.textContent.trim().length : 0;
              });
              if (textLen > 100) {
                contentReady = true;
              } else {
                log(`⚠️ Article element found but too short (${textLen} chars), may be error page...`);
              }
            } catch (_) {
              log('⚠️ Could not find article content selector, continuing...');
            }

            if (!contentReady) {
              const pageInfo = await page.evaluate(() => {
                const bodyText = document.body.innerText.trim();
                const titleText = (document.querySelector('h1, .title, .article-title') || {}).textContent?.trim() || '';
                const errorIndicators = [
                  '请先登录', '登录后查看更多', '内容加载失败', '页面不存在',
                  '已被删除', '无法访问', '加载中...', 'loading...', '加载失败',
                ];
                const isErrorPage = errorIndicators.some(ind => bodyText.includes(ind) || titleText.includes(ind));
                const hasContent = bodyText.length > 200;
                return {
                  titleText: titleText.slice(0, 100),
                  bodyLength: bodyText.length,
                  isErrorPage,
                  hasContent,
                  url: window.location.href,
                };
              });

              log(`   Page state: title="${pageInfo.titleText}", body=${pageInfo.bodyLength} chars, error=${pageInfo.isErrorPage}`);

              if (pageInfo.isErrorPage || !pageInfo.hasContent) {
                log('❌ Xueqiu error/blocked page detected, will retry navigation...');
                throw new Error('Xueqiu error page detected: ' + pageInfo.titleText);
              }

              if (!contentReady && pageInfo.hasContent) {
                log('⚠️ Content element not found but page has text, will try fallback extraction');
              }
            }
          }

          // Extract article data
          log('📄 Extracting article data...');
          const articleData = await page.evaluate(() => {
            const data = {
              title: '',
              author: '',
              content: '',
              textContent: '',
              publishTime: '',
              url: window.location.href,
            };

            // Title selectors (ordered by priority)
            const titleSelectors = [
              'h1.article-title', 'h1.title', '.article-title h1', '.article__title',
              '.article-title', 'h1', '.title', '[class*="article-title"]', '[class*="ArticleTitle"]',
              '.status-title', '.article-title-text',
            ];
            for (const sel of titleSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                data.title = el.textContent.trim();
                break;
              }
            }

            // Author selectors
            const authorSelectors = [
              '.author-name', '.article-author', '.user-name', '.author',
              '[class*="author-name"]', '[class*="AuthorName"]', '[class*="user-name"]', '[class*="UserName"]',
              '.status-user-name', '.user-info .name',
              // Xueqiu specific: hidden metadata paragraph
              '.article__bd__detail p[style*="display:none"], .article__bd p[style*="display:none"], .article-detail p[style*="none"]',
            ];
            for (const sel of authorSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                const text = el.textContent.trim();
                // Try to extract author from "作者：XXX" pattern
                const authorMatch = text.match(/作者[：:]\s*([^，,（(]+)/);
                if (authorMatch) {
                  data.author = authorMatch[1].trim();
                  break;
                }
                data.author = text;
                break;
              }
            }

            // Content selectors (try multiple patterns)
            const contentSelectors = [
              'article.article__bd', '.article__bd', '.article-content', '.article__content',
              'article', '.content', '[class*="article-content"]', '[class*="ArticleContent"]',
              '.post-content', '.article-body', '#article_content', '.status-content',
              '.article-text', '.status-text', '.timeline__article__content',
              // Xueqiu article body
              '.article__bd__detail', '.article-detail__content',
            ];
            for (const sel of contentSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim().length > 100) {
                data.content = el.innerHTML;
                data.textContent = el.textContent.trim();
                break;
              }
            }

            // Time selectors
            const timeSelectors = [
              '.article-time', '.publish-time', '.time', '[class*="article-time"]', '[class*="publish-time"]',
              'time', '[class*="time"]', '[class*="Time"]', '[class*="date"]', '[class*="Date"]',
              '.status-time', '.article__time', '.created-time',
              // Xueqiu specific
              '.article__bd__detail .time', '.status-publish-time',
            ];
            for (const sel of timeSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                const timeText = el.textContent.trim();
                // Basic validation: reject obvious non-time values
                const looksLikeTime = /^\d|年|月|日|前|刚刚|分钟|小时|天|周|月|季|年|昨天|今天|明天|星期|周[一二三四五六日]/.test(timeText) ||
                                      timeText.length >= 6 && /^\d{4}/.test(timeText);
                if (looksLikeTime) {
                  data.publishTime = timeText;
                  break;
                }
              }
            }

            // Fallback: extract from meta tags
            if (!data.title) {
              const metaTitle = document.querySelector('meta[property="og:title"]');
              if (metaTitle) data.title = metaTitle.getAttribute('content');
            }

            // Fallback: extract from title tag
            if (!data.title) {
              data.title = document.title?.replace(/\s*-\s*雪球.*$/, '').trim() || '';
            }

            // Fallback: extract from body text
            if (!data.textContent) {
              const bodyText = document.body.innerText.trim();
              if (bodyText.length > 200) {
                data.textContent = bodyText;
              }
            }

            return data;
          });

          const hasTitle = articleData.title && articleData.title.length > 0;
          const hasContent = articleData.textContent && articleData.textContent.length > 100;
          return {
            articleData,
            contentReady: hasTitle && hasContent,
          };
        },
      });
      return result;
    },
    log,
  });
}

/**
 * Convert HTML string to plain text (Node-side, no browser DOM required).
 * Uses a simple tag-stripping approach that preserves meaningful whitespace.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  // Insert newline before block-level tags, then strip all tags
  const text = html
    .replace(/<\s*(p|div|br|tr|li|h[1-6]|blockquote|pre|ul|ol|table|thead|tbody|tfoot|section|article|header|footer|aside|nav|main|figure|figcaption)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/**
 * Try to fetch Xueqiu article via API (more reliable, bypasses HTML scraping issues)
 * @param {Page} page - Playwright page
 * @param {string} articleUrl - The Xueqiu article URL
 * @param {Function} log - Logger function
 * @returns {Promise<Object|null>} - Article data or null if API fails
 */
async function _tryXueqiuApi(page, articleUrl, log) {
  try {
    // Extract article ID from URL
    // Patterns: https://xueqiu.com/123456/789012345 or https://xueqiu.com/status/123456789
    const idMatch = articleUrl.match(/\/(\d+)(?:\/|\?|$)/);
    if (!idMatch) {
      log('   [API] Could not extract article ID from URL');
      return null;
    }

    const articleId = idMatch[1];
    log(`   [API] Trying direct API access for article ${articleId}...`);

    // Try Xueqiu API endpoints
    const apiUrls = [
      `https://xueqiu.com/statuses/original/show.json?id=${articleId}`,
      `https://xueqiu.com/statuses/${articleId}/detail.json`,
    ];

    // Get cookies from the page context
    const cookies = await page.context().cookies();
    const cookieString = cookies
      .filter(c => c.domain.includes('xueqiu.com'))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    if (!cookieString) {
      log('   [API] No cookies available, skipping API attempt');
      return null;
    }

    for (const apiUrl of apiUrls) {
      try {
        const response = await page.evaluate(async (url, cookies) => {
          try {
            const res = await fetch(url, {
              method: 'GET',
              headers: {
                'Cookie': cookies,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://xueqiu.com/',
                'User-Agent': navigator.userAgent,
              },
              credentials: 'include',
            });
            if (!res.ok) return { error: `HTTP ${res.status}` };
            const text = await res.text();
            try {
              return { data: JSON.parse(text) };
            } catch (_) {
              return { data: text };
            }
          } catch (e) {
            return { error: e.message };
          }
        }, apiUrl, cookieString);

        if (response.error) {
          log(`   [API] ${apiUrls.indexOf(apiUrl) + 1}/${apiUrls.length} failed: ${response.error}`);
          continue;
        }

        if (response.data) {
          const data = response.data;
          // Parse API response
          let articleData = {
            title: '',
            author: '',
            content: '',
            textContent: '',
            publishTime: '',
            url: articleUrl,
          };

          // Try to extract from API response structure
          if (typeof data === 'object') {
            articleData.title = data.title || data.status_title || data.description || '';
            articleData.author = data.user?.screen_name || data.user?.name || data.author || '';
            articleData.content = data.text || data.description || data.content || '';
            articleData.textContent = data.text || data.description || data.content || '';
            articleData.publishTime = data.created_at || data.time || data.publishTime || '';

            // If content is HTML, extract text on Node side (no browser DOM needed)
            if (articleData.content && articleData.content.includes('<')) {
              articleData.textContent = htmlToText(articleData.content) || articleData.textContent;
            }
          }

          if (articleData.title || articleData.textContent) {
            log('   [API] ✅ Successfully fetched via API');
            return {
              success: true,
              data: articleData,
              url: articleUrl,
            };
          }
        }
      } catch (err) {
        log(`   [API] Error: ${err.message}`);
      }
    }

    log('   [API] All API attempts failed, falling back to HTML');
    return null;
  } catch (err) {
    log('   [API] Exception:', err.message);
    return null;
  }
}

// ─── WECHAT ARTICLE FETCHER ───────────────────────────────────────────────────

/**
 * Fetch a WeChat Official Account article with automatic slider captcha handling
 * Enhanced anti-detection for WeChat's environment checks
 * @param {string} articleUrl - The WeChat article URL (mp.weixin.qq.com)
 * @param {Object} opts - Options
 * @returns {Promise<Object>} - Article data
 */
async function fetchWechatArticle(articleUrl, opts = {}) {
  const {
    headless = true,
    verbose = true,
    timeout = 60000,
    waitForContent = true,
  } = opts;

  const log = verbose ? (...a) => console.log('[wechat]', ...a) : () => {};

  log('🚀 Launching Freeman Browser for WeChat...');
  log(`🔗 URL: ${articleUrl}`);

  return withBrowser({
    launchOpts: { mobile: false, headless },
    initScripts: [
      () => {
        // Override window.navigator properties that WeChat checks
        Object.defineProperty(window.navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' });

        // Prevent WeChat from detecting automation via window.chrome
        if (window.chrome) {
          Object.defineProperty(window.chrome, 'csi', { get: () => () => ({startE: 0, onloadT: Date.now(), transition: 0}) });
          Object.defineProperty(window.chrome, 'loadTimes', { get: () => () => ({requestTime: Date.now()/1000 - 1, startLoadTime: Date.now()/1000 - 1, commitLoadTime: Date.now()/1000 - 0.5, finishDocumentLoadTime: Date.now()/1000 - 0.3, finishLoadTime: Date.now()/1000 - 0.2, firstPaintTime: Date.now()/1000 - 0.4, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: false, npnNegotiatedProtocol: '', }) });
        }

        // Override document.hidden / visibilityState (WeChat checks these)
        Object.defineProperty(document, 'hidden', { get: () => false });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });

        // Override document.hasFocus
        if (document.hasFocus) {
          document.hasFocus = () => true;
        }

        // Override performance timing to look realistic
        if (performance.timing) {
          const now = Date.now();
          performance.timing = {
            ...performance.timing,
            navigationStart: now - 5000,
            unloadEventStart: now - 4000,
            unloadEventEnd: now - 3800,
            redirectStart: now - 3700,
            redirectEnd: now - 3600,
            fetchStart: now - 3500,
            domainLookupStart: now - 3400,
            domainLookupEnd: now - 3200,
            connectStart: now - 3100,
            connectEnd: now - 2800,
            requestStart: now - 2700,
            responseStart: now - 1500,
            responseEnd: now - 1000,
            domLoading: now - 900,
            domInteractive: now - 500,
            domContentLoadedEventStart: now - 400,
            domContentLoadedEventEnd: now - 300,
            domComplete: now - 100,
            loadEventStart: now - 50,
            loadEventEnd: now,
          };
        }

        // Intercept and allow WeChat's resource loading
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          // Allow WeChat's own resources
          if (url.includes('res.wx.qq.com') || url.includes('mmbiz.qpic.cn') || url.includes('mp.weixin.qq.com')) {
            return originalFetch.apply(this, args);
          }
          // Block obvious tracking
          if (url.includes('trace') || url.includes('log') || url.includes('beacon')) {
            return new Response(null, { status: 200 });
          }
          return originalFetch.apply(this, args);
        };
      },
    ],
    work: async (page) => {
      // Use shared retry wrapper for navigation + extraction
      const result = await retryExtract({
        log,
        label: 'wechat',
        page,
        retries: 2,
        attemptFn: async ({ attempt, page }) => {
          // Navigate to the article
          log('📡 Navigating to article...');
          await smartNavigate(page, articleUrl, { timeout, waitUntil: 'auto' });

          // Wait for initial load
          await sleep(3000 + attempt * 1000);

          // Check for slider captcha
          log('🔍 Checking for slider captcha...');
          const sliderDetected = await detectSliderCaptcha(page);

          if (sliderDetected) {
            log('🚨 Slider captcha detected, attempting to solve...');
            const solved = await solveSliderCaptcha(page, { verbose, maxRetries: 3 });
            if (!solved) {
              log('❌ Failed to solve slider captcha');
              try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                await page.screenshot({ path: `wechat_slider_failed_${timestamp}.png` });
                log(`📸 Screenshot saved to wechat_slider_failed_${timestamp}.png`);
              } catch (_) {}
              throw new Error('Slider captcha could not be solved');
            }
            log('✅ Slider captcha solved!');
            await sleep(5000 + attempt * 1000);
          }

          // Wait for article content to load
          let contentReady = false;
          if (waitForContent) {
            log('⏳ Waiting for article content...');
            try {
              // Wait for the actual article content element with stricter criteria
              await page.waitForSelector('#js_content', {
                timeout: 30000,
                state: 'attached',
              });
              const textLen = await page.evaluate(() => {
                const el = document.querySelector('#js_content');
                return el ? el.textContent.trim().length : 0;
              });
              if (textLen > 100) {
                contentReady = true;
              } else {
                log(`⚠️ #js_content found but too short (${textLen} chars), may be error page...`);
              }
            } catch (_) {
              log('⚠️ Could not find #js_content within timeout, continuing with fallback selectors...');
            }

            // If content is not ready, check if we're on an error/anti-bot page
            if (!contentReady) {
              const pageInfo = await page.evaluate(() => {
                const bodyText = document.body.innerText.trim();
                const titleText = (document.querySelector('#activity_name, .rich_media_title, h1') || {}).textContent?.trim() || '';
                const errorIndicators = [
                  '环境异常', '操作频繁', '请在微信客户端打开',
                  '该内容已被删除', '此内容因违规无法查看',
                  '无法验证', '请稍后重试', 'loading...', '加载中',
                  '请输入验证码', '人机验证', '安全验证',
                ];
                const isErrorPage = errorIndicators.some(ind => bodyText.includes(ind) || titleText.includes(ind));
                const hasContent = bodyText.length > 500;
                return {
                  titleText: titleText.slice(0, 100),
                  bodyLength: bodyText.length,
                  isErrorPage,
                  hasContent,
                  url: window.location.href,
                };
              });

              log(`   Page state: title="${pageInfo.titleText}", body=${pageInfo.bodyLength} chars, error=${pageInfo.isErrorPage}`);

              if (pageInfo.isErrorPage || !pageInfo.hasContent) {
                log('❌ WeChat error/anti-bot page detected, will retry navigation...');
                throw new Error('WeChat error page detected: ' + pageInfo.titleText);
              }

              if (!contentReady && pageInfo.hasContent) {
                log('⚠️ Content element not found but page has text, will try fallback extraction');
              }
            }
          }

          // Extract article data with WeChat-specific selectors
          log('📄 Extracting WeChat article data...');
          const articleData = await page.evaluate(() => {
            const data = {
              title: '',
              author: '',
              content: '',
              textContent: '',
              publishTime: '',
              source: '',
              url: window.location.href,
            };

            // WeChat title selectors (most specific first)
            const titleSelectors = [
              '#activity_name',
              '.rich_media_title',
              'h2.rich_media_title',
              'h1',
              '.article-title',
              '#js_article_title',
              '#activity-name',
              '.weui-msg__title',
            ];
            for (const sel of titleSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                data.title = el.textContent.trim();
                break;
              }
            }

            // WeChat author selectors
            const authorSelectors = [
              '#js_name',
              '.profile_nickname',
              '.rich_media_meta_nickname',
              '#profileBt a',
              '.account_nickname',
              '.wx_follow_nickname',
              '#js_name_container .rich_media_meta_nickname',
            ];
            for (const sel of authorSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                data.author = el.textContent.trim();
                break;
              }
            }

            // WeChat content selectors
            const contentSelectors = [
              '#js_content',
              '.rich_media_content',
              '#js_article_content',
              '.article-content',
              '#content',
              '#img-content',
              '.weui-msg__text-area',
              '.rich_media_inner',
            ];
            for (const sel of contentSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim().length > 100) {
                data.content = el.innerHTML;
                data.textContent = el.textContent.trim();
                break;
              }
            }

            // WeChat publish time selectors
            const timeSelectors = [
              '#publish_time',
              '.rich_media_meta_text',
              '#js_publish_time',
              '.article-date',
              'em#publish_time',
              '.publish_time',
              '#post-date',
              '.rich_media_meta_primary_text',
            ];
            for (const sel of timeSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                data.publishTime = el.textContent.trim();
                break;
              }
            }

            // WeChat source/original link
            const sourceSelectors = [
              '.rich_media_meta_link',
              '#js_source_url',
              '.original_link',
              '#source_url',
            ];
            for (const sel of sourceSelectors) {
              const el = document.querySelector(sel);
              if (el) {
                data.source = el.href || el.textContent.trim();
                break;
              }
            }

            // Fallback: extract from meta tags
            if (!data.title) {
              const metaTitle = document.querySelector('meta[property="og:title"], meta[name="title"]');
              if (metaTitle) data.title = metaTitle.getAttribute('content');
            }

            // Fallback: extract author from text content if not found
            if (!data.author && data.textContent) {
              const lines = data.textContent.split('\n').filter(l => l.trim());
              if (lines.length > 1) {
                const secondLine = lines[1].trim();
                if (secondLine.length < 50 && !secondLine.includes('：') && !secondLine.includes(':')) {
                  data.author = secondLine;
                }
              }
            }

            // Fallback: extract publish time from text content
            if (!data.publishTime && data.textContent) {
              const datePatterns = [
                /(\d{4}年\d{1,2}月\d{1,2}日)/,
                /(\d{4}-\d{2}-\d{2})/,
                /(\d{4}\/\d{2}\/\d{2})/,
              ];
              for (const pattern of datePatterns) {
                const match = data.textContent.match(pattern);
                if (match) {
                  data.publishTime = match[1];
                  break;
                }
              }
            }

            // If no content found, try body text
            if (!data.textContent) {
              const bodyText = document.body.innerText.trim();
              if (bodyText.length > 200) {
                data.textContent = bodyText;
              }
            }

            return data;
          });

          const hasTitle = articleData.title && articleData.title.length > 0;
          const hasContent = articleData.textContent && articleData.textContent.length > 100;
          return {
            articleData,
            contentReady: hasTitle && hasContent,
          };
        },
      });
      return result;
    },
    log,
  });
}

// ─── GENERIC ARTICLE FETCHER ────────────────────────────────────────────────────

/**
 * Fetch an article from any supported platform (auto-detects the platform)
 * @param {string} articleUrl - The article URL
 * @param {Object} opts - Options
 * @returns {Promise<Object>} - Article data
 */
async function fetchArticle(articleUrl, opts = {}) {
  // Platform detection
  if (articleUrl.includes('xueqiu.com')) {
    return fetchXueqiuArticle(articleUrl, opts);
  } else if (articleUrl.includes('mp.weixin.qq.com')) {
    return fetchWechatArticle(articleUrl, opts);
  } else {
    // Generic fallback - try to fetch any article
    return fetchGenericArticle(articleUrl, opts);
  }
}

/**
 * Generic article fetcher for unsupported platforms
 * @param {string} articleUrl - The article URL
 * @param {Object} opts - Options
 * @returns {Promise<Object>} - Article data
 */
async function fetchGenericArticle(articleUrl, opts = {}) {
  const {
    headless = true,
    verbose = true,
    timeout = 60000,
  } = opts;

  const log = verbose ? (...a) => console.log('[generic]', ...a) : () => {};

  log('🚀 Launching Freeman Browser...');
  log(`🔗 URL: ${articleUrl}`);

  return withBrowser({
    launchOpts: { mobile: false, headless },
    work: async (page) => {
      // Use shared retry wrapper for navigation + extraction
      const result = await retryExtract({
        log,
        label: 'generic',
        page,
        retries: 2,
        attemptFn: async ({ attempt, page }) => {
          log('📡 Navigating to article...');
          await smartNavigate(page, articleUrl, { timeout, waitUntil: 'auto' });

          // Wait for initial load
          await sleep(3000 + attempt * 1000);

          // Check for slider captcha
          log('🔍 Checking for slider captcha...');
          const sliderDetected = await detectSliderCaptcha(page);

          if (sliderDetected) {
            log('🚨 Slider captcha detected, attempting to solve...');
            const solved = await solveSliderCaptcha(page, { verbose, maxRetries: 3 });
            if (!solved) {
              log('❌ Failed to solve slider captcha');
              try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                await page.screenshot({ path: `generic_slider_failed_${timestamp}.png` });
              } catch (_) {}
              throw new Error('Slider captcha could not be solved');
            }
            log('✅ Slider captcha solved!');
            await sleep(5000 + attempt * 1000);
          }

          // Extract article data
          log(`📄 [generic] Extracting article data (attempt ${attempt + 1})...`);
          const articleData = await page.evaluate(() => {
            const data = {
              title: '',
              author: '',
              content: '',
              textContent: '',
              publishTime: '',
              url: window.location.href,
            };

            // Generic title selectors
            const titleSelectors = [
              'h1', 'h1.title', 'h1.article-title', '.article-title', '.post-title',
              '[class*="title"]', '[class*="Title"]', 'meta[property="og:title"]',
              'title'
            ];
            for (const sel of titleSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                data.title = sel === 'title' ? el.textContent.trim().split(/[-|–—]/)[0].trim() : el.textContent.trim();
                break;
              }
            }

            // Generic author selectors
            const authorSelectors = [
              '.author', '.author-name', '.byline', '[class*="author"]', '[class*="Author"]',
              '[rel="author"]', '.entry-author',
            ];
            for (const sel of authorSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim()) {
                data.author = el.textContent.trim();
                break;
              }
            }

            // Generic content selectors
            const contentSelectors = [
              'article', 'main', '.article-content', '.post-content', '.content',
              '[class*="content"]', '[class*="Content"]', '.entry-content',
              '[itemprop="articleBody"]', '.article-body', '.post-body',
            ];
            for (const sel of contentSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim().length > 100) {
                data.content = el.innerHTML;
                data.textContent = el.textContent.trim();
                break;
              }
            }

            // Fallback: use body text
            if (!data.textContent) {
              const bodyText = document.body.innerText.trim();
              if (bodyText.length > 200) {
                data.textContent = bodyText;
              }
            }

            return data;
          });

          const hasTitle = articleData.title && articleData.title.length > 0;
          const hasContent = articleData.textContent && articleData.textContent.length > 100;
          return {
            articleData,
            contentReady: hasTitle && hasContent,
          };
        },
      });
      return result;
    },
    log,
  });
}

// ─── ACCESSIBILITY SNAPSHOT (inspired by agent-browser) ────────────────────────

/**
 * Take an accessibility tree snapshot of the page, assigning @e1, @e2 refs
 * to every interactive element. AI agents use these refs to click/fill.
 *
 * @param {Page} page - Playwright page
 * @param {Object} opts
 * @param {boolean} opts.includeNonInteractive - include text nodes too
 * @returns {Promise<{refs: Object, tree: Object, text: string}>}
 */
async function snapshot(page, opts = {}) {
  const { includeNonInteractive = false } = opts;

  // Collect all interactive elements with their metadata
  const elements = await page.evaluate((incNon) => {
    const interactiveSelectors = [
      'a', 'button', 'input', 'textarea', 'select', '[role="button"]',
      '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="checkbox"]',
      '[role="radio"]', '[role="switch"]', '[role="slider"]', '[role="textbox"]',
      '[role="combobox"]', '[role="listbox"]', '[role="option"]',
      '[contenteditable="true"]', '[tabindex]', 'details', 'summary',
      'label', '[onclick]', '[onkeydown]',
    ];

    // Also include headings and paragraphs for reading
    const readingSelectors = incNon
      ? ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'blockquote', 'pre', 'code']
      : [];

    const allSelectors = [...interactiveSelectors, ...readingSelectors].join(', ');
    const els = document.querySelectorAll(allSelectors);
    const result = [];
    const seen = new Set();

    for (const el of els) {
      const rect = el.getBoundingClientRect();
      // Skip invisible elements
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const name = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        el.textContent?.trim().slice(0, 60) ||
        ''
      ).replace(/\s+/g, ' ');

      const key = `${tag}|${role}|${name}|${Math.round(rect.x)}|${Math.round(rect.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        tag,
        role,
        name,
        type: el.type || '',
        href: el.href || '',
        value: el.value ? String(el.value).slice(0, 100) : '',
        disabled: el.disabled || false,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        // Generate a unique CSS selector for this element
        selector: (() => {
          if (el.id) return `#${el.id}`;
          if (el.name) return `${tag}[name="${el.name}"]`;
          // nth-child path
          const path = [];
          let cur = el;
          while (cur && cur !== document.body) {
            let nth = 1;
            let sib = cur.previousElementSibling;
            while (sib) { nth++; sib = sib.previousElementSibling; }
            const curTag = cur.tagName.toLowerCase();
            const idPart = cur.id ? `#${cur.id}` : '';
            path.unshift(`${curTag}${idPart}:nth-child(${nth})`);
            cur = cur.parentElement;
          }
          return path.join(' > ');
        })(),
      });
    }

    return result;
  }, includeNonInteractive);

  // Build refs map: @e1 -> element info
  const refs = {};
  const refList = [];
  elements.forEach((el, i) => {
    const refId = `@e${i + 1}`;
    refs[refId] = el;
    refList.push(refId);
  });

  // Build a human-readable text representation
  const textLines = elements.map((el, i) => {
    const refId = `@e${i + 1}`;
    const parts = [refId];
    if (el.role) parts.push(`[${el.role}]`);
    else parts.push(`[${el.tag}]`);
    if (el.name) parts.push(`"${el.name}"`);
    if (el.type) parts.push(`(type=${el.type})`);
    if (el.value) parts.push(`value="${el.value}"`);
    if (el.disabled) parts.push('(disabled)');
    return parts.join(' ');
  });

  // Also get the raw accessibility tree from Playwright
  let tree = null;
  try {
    tree = await page.accessibility.snapshot({ interestingOnly: false });
  } catch (_) {
    // accessibility.snapshot may fail on some pages
  }

  return {
    refs,
    refList,
    count: elements.length,
    tree,
    text: textLines.join('\n'),
  };
}

// ─── SMART READ URL (inspired by agent-browser `read` command) ─────────────────

/**
 * Navigate to a URL and extract readable content.
 * Detects platform (WeChat, Xueqiu, generic) and handles slider captchas.
 *
 * @param {string} url - The URL to read
 * @param {Object} opts
 * @param {string} opts.format - 'text' | 'markdown' | 'html' (default: 'text')
 * @param {boolean} opts.headless - run headless (default: true)
 * @param {number} opts.timeout - navigation timeout (default: 60000)
 * @returns {Promise<{title: string, content: string, url: string, platform: string}>}
 */
async function readUrl(url, opts = {}) {
  const { format = 'text', headless = true, timeout = 60000, verbose = false } = opts;
  const log = verbose ? (...a) => console.log('[read]', ...a) : () => {};

  log(`Reading: ${url}`);

  // Detect platform
  let platform = 'generic';
  if (url.includes('xueqiu.com')) platform = 'xueqiu';
  else if (url.includes('mp.weixin.qq.com')) platform = 'wechat';

  // Platform-specific init scripts
  const initScripts = [];
  if (platform === 'wechat') {
    initScripts.push(() => {
      Object.defineProperty(window.navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' });
      if (window.chrome) {
        Object.defineProperty(window.chrome, 'csi', { get: () => () => ({startE: 0, onloadT: Date.now(), transition: 0}) });
        Object.defineProperty(window.chrome, 'loadTimes', { get: () => () => ({requestTime: Date.now()/1000 - 1, startLoadTime: Date.now()/1000 - 1, commitLoadTime: Date.now()/1000 - 0.5, finishDocumentLoadTime: Date.now()/1000 - 0.3, finishLoadTime: Date.now()/1000 - 0.2, firstPaintTime: Date.now()/1000 - 0.4, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: false, npnNegotiatedProtocol: '', }) });
      }
      Object.defineProperty(document, 'hidden', { get: () => false });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      if (document.hasFocus) document.hasFocus = () => true;
      if (performance.timing) {
        const now = Date.now();
        performance.timing = {
          ...performance.timing,
          navigationStart: now - 5000, unloadEventStart: now - 4000, unloadEventEnd: now - 3800,
          redirectStart: now - 3700, redirectEnd: now - 3600, fetchStart: now - 3500,
          domainLookupStart: now - 3400, domainLookupEnd: now - 3200, connectStart: now - 3100,
          connectEnd: now - 2800, requestStart: now - 2700, responseStart: now - 1500,
          responseEnd: now - 1000, domLoading: now - 900, domInteractive: now - 500,
          domContentLoadedEventStart: now - 400, domContentLoadedEventEnd: now - 300,
          domComplete: now - 100, loadEventStart: now - 50, loadEventEnd: now,
        };
      }
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const u = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (u.includes('res.wx.qq.com') || u.includes('mmbiz.qpic.cn') || u.includes('mp.weixin.qq.com')) return originalFetch.apply(this, args);
        if (u.includes('trace') || u.includes('log') || u.includes('beacon')) return new Response(null, { status: 200 });
        return originalFetch.apply(this, args);
      };
    });
  } else if (platform === 'xueqiu') {
    initScripts.push(() => {
      const originalRTCPeerConnection = window.RTCPeerConnection;
      if (originalRTCPeerConnection) {
        window.RTCPeerConnection = function(...args) {
          const pc = new originalRTCPeerConnection(...args);
          const originalCreateDataChannel = pc.createDataChannel.bind(pc);
          pc.createDataChannel = function(...dcArgs) { return originalCreateDataChannel(...dcArgs); };
          return pc;
        };
      }
    });
  }

  return withBrowser({
    launchOpts: { mobile: false, headless },
    initScripts,
    work: async (page) => {
      const result = await retryExtract({
        log,
        label: 'read',
        page,
        retries: 2,
        attemptFn: async ({ attempt, page }) => {
          log('📡 Navigating to article...');
          await smartNavigate(page, url, { timeout, waitUntil: 'auto' });

          await sleep(3000 + attempt * 1000);

          // Handle slider captcha
          log('🔍 Checking for slider captcha...');
          const sliderDetected = await detectSliderCaptcha(page);
          if (sliderDetected) {
            log('🚨 Slider captcha detected, solving...');
            const solved = await solveSliderCaptcha(page, { verbose, maxRetries: 3 });
            if (!solved) throw new Error('Slider captcha could not be solved');
            log('✅ Slider captcha solved!');
            await sleep(5000 + attempt * 1000);
          }

          // Extract content
          log('📄 Extracting content...');
          const data = await page.evaluate(({ fmt, plat }) => {
            const result = { title: '', author: '', content: '', publishTime: '' };

            // Title
            const titleSels = plat === 'wechat'
              ? ['#activity_name', '.rich_media_title', 'h2.rich_media_title', 'h1', '.article-title', '#js_article_title']
              : plat === 'xueqiu'
                ? ['h1.article-title', 'h1.title', '.article-title h1', '.article__title', '.article-title', 'h1', '.title']
                : ['h1', 'h1.title', 'h1.article-title', '.article-title', '.post-title', '[class*="title"]', 'title'];
            for (const s of titleSels) {
              const el = document.querySelector(s);
              if (el && el.textContent.trim()) { result.title = el.textContent.trim(); break; }
            }

            // Author
            const authorSels = plat === 'wechat'
              ? ['#js_name', '.profile_nickname', '.rich_media_meta_nickname', '#profileBt a']
              : plat === 'xueqiu'
                ? ['.author-name', '.article-author', '.user-name', '.author', '.status-user-name', '.user-info .name']
                : ['.author', '.author-name', '.byline', '[class*="author"]'];
            for (const s of authorSels) {
              const el = document.querySelector(s);
              if (el && el.textContent.trim()) { result.author = el.textContent.trim(); break; }
            }

            // Content
            const contentSels = plat === 'wechat'
              ? ['#js_content', '.rich_media_content', '#js_article_content', '.article-content']
              : plat === 'xueqiu'
                ? ['article.article__bd', '.article__bd', '.article__bd__detail', '.article-content', 'article']
                : ['article', 'main', '.article-content', '.post-content', '.content', '[class*="content"]'];
            for (const s of contentSels) {
              const el = document.querySelector(s);
              if (el && el.textContent.trim().length > 100) {
                result.content = fmt === 'html' ? el.innerHTML : el.innerText.trim();
                break;
              }
            }

            // Publish time
            const timeSels = plat === 'wechat'
              ? ['#publish_time', '.rich_media_meta_text', '#js_publish_time', '.article-date']
              : plat === 'xueqiu'
                ? ['.article-time', '.publish-time', '.time', '.status-time', '.article__time']
                : ['.article-time', '.publish-time', 'time', '[class*="time"]'];
            for (const s of timeSels) {
              const el = document.querySelector(s);
              if (el && el.textContent.trim()) { result.publishTime = el.textContent.trim(); break; }
            }

            // Fallback content
            if (!result.content) {
              const body = document.body.innerText.trim();
              if (body.length > 200) result.content = body;
            }

            return result;
          }, { fmt: format, plat: platform });

          const hasTitle = data.title && data.title.length > 0;
          const hasContent = data.content && data.content.length > 100;
          return {
            articleData: data,
            contentReady: hasTitle && hasContent,
          };
        },
      });

      if (result.success) {
        return {
          title: result.data.title,
          author: result.data.author,
          content: result.data.content,
          publishTime: result.data.publishTime,
          url,
          platform,
        };
      }
      throw new Error('Failed to extract article');
    },
    log,
  });
}

// ─── SESSION PERSISTENCE (inspired by agent-browser profiles) ──────────────────

/**
 * Save browser session (cookies + storage state) to a file.
 * @param {BrowserContext} ctx - Playwright browser context
 * @param {string} filePath - Path to save session JSON
 */
async function saveSession(ctx, filePath) {
  const cookies = await ctx.cookies();
  const storageState = await ctx.storageState();
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    cookies,
    storageState,
  };
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[freeman-browser] Session saved to ${filePath} (${cookies.length} cookies)`);
}

/**
 * Create a new browser context from a saved session file.
 * @param {Browser} browser - Playwright browser instance
 * @param {string} filePath - Path to session JSON file
 * @param {Object} opts - Additional context options (e.g. device profile)
 * @returns {Promise<BrowserContext>}
 */
async function loadSession(browser, filePath, opts = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session file not found: ${filePath}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!data.storageState) {
    throw new Error(`Invalid session file (missing storageState): ${filePath}`);
  }
  const ctx = await browser.newContext({
    ...opts,
    storageState: data.storageState,
    ignoreHTTPSErrors: true,
  });
  console.log(`[freeman-browser] Session loaded from ${filePath} (saved ${data.savedAt})`);
  return ctx;
}

// ─── ANNOTATED SCREENSHOT (inspired by agent-browser) ──────────────────────────

/**
 * Take a screenshot with numbered labels overlaid on interactive elements.
 * Labels match the @e1, @e2 refs from snapshot().
 *
 * @param {Page} page - Playwright page
 * @param {string} filePath - Path to save the screenshot
 * @param {Object} opts
 * @param {string} opts.selector - CSS selector to scope (default: all interactive)
 * @returns {Promise<{path: string, elements: Array}>}
 */
async function annotateScreenshot(page, filePath, opts = {}) {
  // Get all interactive elements with bounding boxes
  const elements = await page.evaluate(() => {
    const sels = 'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [onclick]';
    const els = document.querySelectorAll(sels);
    const result = [];
    const seen = new Set();
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const key = `${Math.round(rect.x)}|${Math.round(rect.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || '').replace(/"/g, ''),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
    return result;
  });

  // Inject SVG overlay with numbered labels
  const overlayId = '__freeman_annotate_' + Date.now();
  await page.evaluate(({ els, id }) => {
    const svg = document.createElement('div');
    svg.id = id;
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
    svg.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
      els.map((el, i) => {
        const label = `@e${i + 1}`;
        const lx = el.x;
        const ly = Math.max(el.y - 20, 2);
        return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="rgba(66,133,244,0.15)" stroke="rgba(66,133,244,0.6)" stroke-width="1.5" rx="2"/>` +
          `<rect x="${lx}" y="${ly}" width="${label.length * 8 + 8}" height="18" fill="#4285f4" rx="3"/>` +
          `<text x="${lx + 4}" y="${ly + 13}" font-family="monospace" font-size="11" fill="white" font-weight="bold">${label}</text>`;
      }).join('') + `</svg>`;
    document.body.appendChild(svg);
  }, { els: elements, id: overlayId });

  // Take screenshot
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: filePath, fullPage: false });

  // Remove overlay
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, overlayId);

  console.log(`[freeman-browser] Annotated screenshot saved to ${filePath} (${elements.length} elements labeled)`);
  return { path: filePath, elements };
}

// ─── DAEMON MODE (inspired by agent-browser daemon architecture) ────────────────

/**
 * Daemon communication protocol.
 *
 * On Windows, uses a named pipe: \\.\pipe\freeman-browser
 * On Unix, uses a Unix socket: /tmp/freeman-browser.sock
 *
 * The daemon keeps a persistent browser instance. CLI commands connect
 * via IPC and reuse the same browser — no startup overhead.
 */

const DAEMON_PIPE_NAME = 'freeman-browser';
const DAEMON_SOCKET_PATH = process.platform === 'win32'
  ? `\\\\.\\pipe\\${DAEMON_PIPE_NAME}`
  : `/tmp/${DAEMON_PIPE_NAME}.sock`;

let _daemonBrowser = null;
let _daemonCtx = null;
let _daemonPage = null;
let _daemonRefsCache = {};  // cached refs from last snapshot

/**
 * Start the daemon server (called once, keeps running).
 * Listens for IPC commands and executes them on the persistent browser.
 */
async function startDaemon(opts = {}) {
  const net = require('net');
  const { mobile = false, headless = true } = opts;

  // Launch browser once
  console.log('[freeman-daemon] Starting browser daemon...');
  const launched = await launchFreeman({ mobile, headless });
  _daemonBrowser = launched.browser;
  _daemonCtx = launched.ctx || _daemonBrowser.contexts()[0];
  _daemonPage = launched.page;

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      // Process complete JSON messages (newline-delimited)
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;

        let msg;
        try { msg = JSON.parse(line); } catch (e) {
          conn.write(JSON.stringify({ error: 'Invalid JSON' }) + '\n');
          continue;
        }

        // Dispatch command
        _handleDaemonCommand(msg, launched)
          .then(result => conn.write(JSON.stringify({ ok: true, result }) + '\n'))
          .catch(err => conn.write(JSON.stringify({ error: err.message }) + '\n'));
      }
    });
    conn.on('error', () => {});
  });

  // Clean up stale socket on Unix
  if (process.platform !== 'win32' && fs.existsSync(DAEMON_SOCKET_PATH)) {
    fs.unlinkSync(DAEMON_SOCKET_PATH);
  }

  server.listen(DAEMON_SOCKET_PATH, () => {
    console.log(`[freeman-daemon] Listening on ${DAEMON_SOCKET_PATH}`);
    console.log(`[freeman-daemon] PID: ${process.pid}`);
    // Write PID file for CLI to find
    const pidFile = process.platform === 'win32'
      ? path.join(process.env.TEMP || 'C:\\Temp', 'freeman-browser.pid')
      : '/tmp/freeman-browser.pid';
    fs.writeFileSync(pidFile, String(process.pid));
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[freeman-daemon] Shutting down...');
    server.close();
    if (_daemonBrowser) await _daemonBrowser.close();
    _daemonRefsCache = {};
    if (process.platform !== 'win32' && fs.existsSync(DAEMON_SOCKET_PATH)) {
      fs.unlinkSync(DAEMON_SOCKET_PATH);
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

/**
 * Handle a single daemon command.
 */
async function _handleDaemonCommand(msg, launched) {
  const { command, args = {} } = msg;
  const page = _daemonPage;
  const ctx = _daemonCtx;

  switch (command) {
    case 'open':
      await page.goto(args.url, {
        waitUntil: args.waitUntil || 'domcontentloaded',
        timeout: args.timeout || 60000,
      });
      await sleep(1000);
      return { url: page.url(), title: await page.title() };

    case 'snapshot': {
      const snap = await snapshot(page, args);
      _daemonRefsCache = snap.refs;  // cache for click commands
      return snap;
    }

    case 'click': {
      if (args.ref && _daemonRefsCache[args.ref]) {
        const el = _daemonRefsCache[args.ref];
        await humanClick(page, el.rect.x + el.rect.width / 2, el.rect.y + el.rect.height / 2);
      } else if (args.selector) {
        await page.click(args.selector);
      }
      await sleep(500);
      return { url: page.url(), title: await page.title() };
    }

    case 'fill': {
      if (args.selector) {
        await humanType(page, args.selector, args.value);
      }
      return { ok: true };
    }

    case 'read':
      return await readUrl(args.url, args);

    case 'screenshot': {
      const p = args.path || `freeman-screenshot-${Date.now()}.png`;
      if (args.annotate) {
        return await annotateScreenshot(page, p, args);
      }
      await page.screenshot({ path: p, fullPage: args.fullPage || false });
      return { path: p };
    }

    case 'save-session':
      await saveSession(ctx, args.path);
      return { ok: true };

    case 'evaluate': {
      const result = await page.evaluate(args.script);
      return { result };
    }

    case 'html':
      return { html: await page.content() };

    case 'text':
      return { text: await page.textContent('body') };

    case 'url':
      return { url: page.url() };

    case 'title':
      return { title: await page.title() };

    case 'close':
      await _daemonBrowser.close();
      _daemonBrowser = null;
      _daemonPage = null;
      _daemonCtx = null;
      _daemonRefsCache = {};
      return { closed: true };

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Send a command to the running daemon via IPC.
 * @param {Object} msg - { command, args }
 * @returns {Promise<Object>} - daemon response
 */
function sendDaemonCommand(msg) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(DAEMON_SOCKET_PATH);
    conn.setTimeout(30000);
    conn.write(JSON.stringify(msg) + '\n');

    let response = '';
    conn.on('data', (chunk) => {
      response += chunk.toString();
      const nl = response.indexOf('\n');
      if (nl !== -1) {
        const line = response.slice(0, nl).trim();
        conn.destroy();
        try {
          const parsed = JSON.parse(line);
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed.result || parsed);
        } catch (e) {
          reject(new Error(`Invalid daemon response: ${line}`));
        }
      }
    });
    conn.on('error', reject);
    conn.on('timeout', () => { conn.destroy(); reject(new Error('Daemon timeout')); });
  });
}

/**
 * Check if the daemon is running.
 * @returns {boolean}
 */
function isDaemonRunning() {
  const net = require('net');
  return new Promise((resolve) => {
    const conn = net.createConnection(DAEMON_SOCKET_PATH);
    conn.on('connect', () => { conn.destroy(); resolve(true); });
    conn.on('error', () => resolve(false));
    conn.setTimeout(1000);
    conn.on('timeout', () => { conn.destroy(); resolve(false); });
  });
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  launchFreeman,
  humanClick, humanMouseMove, humanType, humanScroll, humanRead,
  solveCaptcha, detectSliderCaptcha, solveSliderCaptcha, handleSliderCaptcha,
  smartNavigate,
  fetchXueqiuArticle, fetchWechatArticle, fetchArticle, fetchGenericArticle,
  shadowQuery, shadowFill, shadowClickButton, dumpInteractiveElements,
  pasteIntoEditor,
  buildDevice,
  sleep, rand,
  // New: agent-browser inspired features
  snapshot, readUrl,
  saveSession, loadSession,
  annotateScreenshot,
  startDaemon, sendDaemonCommand, isDaemonRunning,
};

// ─── QUICK TEST ───────────────────────────────────────────────────────────────
if (require.main === module) {
  const testUrl = process.argv[2] || 'https://ipinfo.io/json';
  const isXueqiu = testUrl.includes('xueqiu.com');

  console.log(`🧪 Testing Freeman Browser`);
  console.log(`   URL: ${testUrl}`);
  console.log(`   Mode: ${isXueqiu ? 'Xueqiu Article Fetch' : 'IP Info Test'}`);
  console.log('');

  (async () => {
    if (isXueqiu) {
      // Test Xueqiu article fetching
      const result = await fetchXueqiuArticle(testUrl, {
        headless: false, // Show browser for debugging
        verbose: true,
      });
      console.log('\n📋 Result:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Standard test
      const { browser, page } = await launchFreeman({ mobile: true });
      await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const info = JSON.parse(await page.textContent('body'));
      console.log(`✅ IP:      ${info.ip}`);
      console.log(`✅ Country: ${info.country} (${info.city})`);
      console.log(`✅ Org:     ${info.org}`);
      console.log(`✅ TZ:      ${info.timezone}`);
      const ua = await page.evaluate(() => navigator.userAgent);
      console.log(`✅ UA:      ${ua.slice(0, 80)}...`);
      await browser.close();
      console.log('\n🎉 Freeman Browser is ready.');
    }
  })().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  });
}
