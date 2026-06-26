#!/usr/bin/env node
/**
 * browser-freeman-cli.js — Freeman Browser CLI (inspired by agent-browser)
 *
 * CLI-first interface for AI agents. Commands reuse a persistent daemon
 * browser, so sequential calls have zero startup overhead.
 *
 * Usage:
 *   node browser-freeman-cli.js open <url>
 *   node browser-freeman-cli.js snapshot [--json]
 *   node browser-freeman-cli.js click @e3
 *   node browser-freeman-cli.js click "button.submit"
 *   node browser-freeman-cli.js fill "input[name=email]" user@example.com
 *   node browser-freeman-cli.js read <url>
 *   node browser-freeman-cli.js screenshot [--annotate] [--path out.png]
 *   node browser-freeman-cli.js save-session ./session.json
 *   node browser-freeman-cli.js load-session ./session.json
 *   node browser-freeman-cli.js evaluate "document.title"
 *   node browser-freeman-cli.js html
 *   node browser-freeman-cli.js text
 *   node browser-freeman-cli.js url
 *   node browser-freeman-cli.js title
 *   node browser-freeman-cli.js close
 *
 * Daemon mode (optional, for persistent browser):
 *   node browser-freeman-cli.js daemon [--mobile] [--desktop] [--headless]
 */

const fs = require('fs');
const path = require('path');

// ─── HELP ──────────────────────────────────────────────────────────────────────

const HELP = `
Freeman Browser CLI — Stealth browser for AI agents

COMMANDS:
  open <url>                 Navigate to URL
  snapshot [--json]          Get accessibility tree with @e refs
  click <@ref|selector>      Click an element (@e1 from snapshot or CSS selector)
  fill <selector> <value>    Fill an input field
  read <url>                 Extract readable content from URL
  screenshot [--annotate] [--path <p>]   Take screenshot (annotate labels interactive elements)
  save-session <path>        Save cookies + auth state
  load-session <path>        Restore cookies + auth state
  evaluate <script>          Run JS in the page
  html                       Get page HTML
  text                       Get page text content
  url                        Get current URL
  title                      Get page title
  close                      Close the browser

DAEMON:
  daemon [--mobile|--desktop] [--headless|--headed]
                             Start persistent browser daemon

OPTIONS:
  --json                     Output as JSON
  --mobile                   Use mobile fingerprint (iPhone 15 Pro)
  --desktop                  Use desktop fingerprint (Chrome)
  --headless                 Run headless (default)
  --headed                   Run with visible browser
  --timeout <ms>             Navigation timeout (default: 60000)
  --path <path>              Screenshot output path
  --annotate                 Add numbered labels to interactive elements

EXAMPLES:
  node browser-freeman-cli.js open https://xueqiu.com
  node browser-freeman-cli.js snapshot --json
  node browser-freeman-cli.js click @e3
  node browser-freeman-cli.js fill "input[name=q]" "茅台"
  node browser-freeman-cli.js read https://mp.weixin.qq.com/s/xxxxx
  node browser-freeman-cli.js screenshot --annotate --path debug.png
`.trim();

// ─── ARGUMENT PARSER ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    command: null,
    positional: [],
    flags: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // Check if next arg is a value (not a flag)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result.flags[key] = args[++i];
      } else {
        result.flags[key] = true;
      }
    } else if (!result.command) {
      result.command = arg;
    } else {
      result.positional.push(arg);
    }
  }

  return result;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const parsed = parseArgs(process.argv);
  const { command, positional, flags } = parsed;

  if (flags.help || !command) {
    console.log(HELP);
    process.exit(flags.help ? 0 : 1);
  }

  // ── DAEMON MODE: start persistent browser ──────────────────────────────
  if (command === 'daemon') {
    const lib = require('./browser-freeman');
    const mobile = flags.mobile || false;
    const desktop = flags.desktop || false;
    const headless = flags.headed ? false : true;

    console.log(`[freeman-browser] Starting daemon (mobile=${mobile}, headless=${headless})`);
    await lib.startDaemon({ mobile: mobile && !desktop, headless });
    // Daemon keeps running — the event loop stays alive via the net.Server
    return;
  }

  // ── NON-DAEMON MODE: use daemon if running, otherwise direct ───────────

  const lib = require('./browser-freeman');
  const daemonRunning = await lib.isDaemonRunning();

  if (daemonRunning) {
    // Send command to daemon via IPC
    await _execViaDaemon(command, positional, flags, lib);
  } else {
    // No daemon — execute directly (slower, starts browser each time)
    await _execDirect(command, positional, flags, lib);
  }
}

// ─── EXEC VIA DAEMON ──────────────────────────────────────────────────────────

async function _execViaDaemon(command, positional, flags, lib) {
  const buildMsg = (cmd, args = {}) => ({ command: cmd, args });

  switch (command) {
    case 'open':
      return _output(await lib.sendDaemonCommand(buildMsg('open', {
        url: positional[0],
        timeout: parseInt(flags.timeout) || 60000,
      })), flags);

    case 'snapshot':
      return _output(await lib.sendDaemonCommand(buildMsg('snapshot', {
        includeNonInteractive: flags.full || false,
      })), flags);

    case 'click':
      if (!positional[0]) { console.error('Usage: click <@ref|selector>'); process.exit(1); }
      const clickArg = positional[0].startsWith('@')
        ? { ref: positional[0] }
        : { selector: positional[0] };
      return _output(await lib.sendDaemonCommand(buildMsg('click', clickArg)), flags);

    case 'fill':
      if (positional.length < 2) { console.error('Usage: fill <selector> <value>'); process.exit(1); }
      return _output(await lib.sendDaemonCommand(buildMsg('fill', {
        selector: positional[0],
        value: positional.slice(1).join(' '),
      })), flags);

    case 'read':
      return _output(await lib.sendDaemonCommand(buildMsg('read', {
        url: positional[0],
        format: flags.format || 'text',
      })), flags);

    case 'screenshot':
      return _output(await lib.sendDaemonCommand(buildMsg('screenshot', {
        path: flags.path || `freeman-${Date.now()}.png`,
        annotate: !!flags.annotate,
        fullPage: !!flags.fullPage,
      })), flags);

    case 'save-session':
      return _output(await lib.sendDaemonCommand(buildMsg('save-session', {
        path: positional[0] || 'session.json',
      })), flags);

    case 'load-session':
      return _output(await lib.sendDaemonCommand(buildMsg('load-session', {
        path: positional[0] || 'session.json',
      })), flags);

    case 'evaluate':
      return _output(await lib.sendDaemonCommand(buildMsg('evaluate', {
        script: positional.join(' '),
      })), flags);

    case 'html':
      return _output(await lib.sendDaemonCommand(buildMsg('html')), flags);

    case 'text':
      return _output(await lib.sendDaemonCommand(buildMsg('text')), flags);

    case 'url':
      return _output(await lib.sendDaemonCommand(buildMsg('url')), flags);

    case 'title':
      return _output(await lib.sendDaemonCommand(buildMsg('title')), flags);

    case 'close':
      return _output(await lib.sendDaemonCommand(buildMsg('close')), flags);

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run with --help for usage.');
      process.exit(1);
  }
}

// ─── EXEC DIRECT (no daemon) ──────────────────────────────────────────────────

async function _execDirect(command, positional, flags, lib) {
  const mobile = flags.mobile || false;
  const desktop = flags.desktop || false;
  const headless = flags.headed ? false : true;
  const isMobile = mobile && !desktop;

  switch (command) {
    case 'open': {
      const { browser, page } = await lib.launchFreeman({ mobile: isMobile, headless });
      await page.goto(positional[0], { timeout: parseInt(flags.timeout) || 60000 });
      await lib.sleep(1000);
      _output({ url: page.url(), title: await page.title() }, flags);
      // Keep browser open — save state for next call
      _saveDirectState(browser, page);
      break;
    }

    case 'snapshot': {
      const page = await _getDirectPage(lib, isMobile, headless);
      const snap = await lib.snapshot(page, { includeNonInteractive: flags.full || false });
      _output(snap, flags);
      break;
    }

    case 'click': {
      if (!positional[0]) { console.error('Usage: click <@ref|selector>'); process.exit(1); }
      const page = await _getDirectPage(lib, isMobile, headless);
      if (positional[0].startsWith('@')) {
        // Need to get refs first
        const snap = await lib.snapshot(page);
        const el = snap.refs[positional[0]];
        if (!el) { console.error(`Ref ${positional[0]} not found. Run 'snapshot' first.`); process.exit(1); }
        await lib.humanClick(page, el.rect.x + el.rect.width / 2, el.rect.y + el.rect.height / 2);
      } else {
        await page.click(positional[0]);
      }
      await lib.sleep(500);
      _output({ url: page.url(), title: await page.title() }, flags);
      break;
    }

    case 'fill': {
      if (positional.length < 2) { console.error('Usage: fill <selector> <value>'); process.exit(1); }
      const page = await _getDirectPage(lib, isMobile, headless);
      await lib.humanType(page, positional[0], positional.slice(1).join(' '));
      _output({ ok: true }, flags);
      break;
    }

    case 'read': {
      const result = await lib.readUrl(positional[0], {
        format: flags.format || 'text',
        headless,
        timeout: parseInt(flags.timeout) || 60000,
      });
      _output(result, flags);
      break;
    }

    case 'screenshot': {
      const page = await _getDirectPage(lib, isMobile, headless);
      const p = flags.path || `freeman-${Date.now()}.png`;
      if (flags.annotate) {
        const result = await lib.annotateScreenshot(page, p, flags);
        _output(result, flags);
      } else {
        await page.screenshot({ path: p, fullPage: !!flags.fullPage });
        _output({ path: p }, flags);
      }
      break;
    }

    case 'save-session': {
      const state = _loadDirectState();
      if (!state) { console.error('No active browser. Run "open" first.'); process.exit(1); }
      const { browser } = state;
      const ctx = browser.contexts()[0];
      await lib.saveSession(ctx, positional[0] || 'session.json');
      _output({ ok: true }, flags);
      break;
    }

    case 'load-session': {
      const p = positional[0] || 'session.json';
      const { browser } = await lib.launchFreeman({ mobile: isMobile, headless });
      const ctx = await lib.loadSession(browser, p);
      const page = await ctx.newPage();
      _saveDirectState(browser, page, ctx);
      _output({ loaded: p }, flags);
      break;
    }

    case 'evaluate': {
      const page = await _getDirectPage(lib, isMobile, headless);
      const result = await page.evaluate(positional.join(' '));
      _output({ result }, flags);
      break;
    }

    case 'html': {
      const page = await _getDirectPage(lib, isMobile, headless);
      _output({ html: await page.content() }, flags);
      break;
    }

    case 'text': {
      const page = await _getDirectPage(lib, isMobile, headless);
      _output({ text: await page.textContent('body') }, flags);
      break;
    }

    case 'url': {
      const page = await _getDirectPage(lib, isMobile, headless);
      _output({ url: page.url() }, flags);
      break;
    }

    case 'title': {
      const page = await _getDirectPage(lib, isMobile, headless);
      _output({ title: await page.title() }, flags);
      break;
    }

    case 'close': {
      const state = _loadDirectState();
      if (state) {
        await state.browser.close();
        _clearDirectState();
      }
      _output({ closed: true }, flags);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run with --help for usage.');
      process.exit(1);
  }
}

// ─── DIRECT STATE MANAGEMENT ──────────────────────────────────────────────────
// In direct mode, we persist the browser PID/state to a temp file so
// sequential CLI calls can reuse the same browser instance.

const STATE_FILE = (() => {
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp';
  return path.join(tmpDir, 'freeman-browser-direct.json');
})();

function _saveDirectState(browser, page, ctx) {
  const state = {
    pid: process.pid,
    savedAt: new Date().toISOString(),
  };
  // We can't serialize browser/page objects to disk in direct mode.
  // Instead, we store the PID and rely on process staying alive.
  // For CLI usage without daemon, each command is a separate process.
  // This is a limitation — use daemon mode for persistence.
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function _loadDirectState() {
  // In direct CLI mode, each invocation is a separate process,
  // so we can't actually share browser instances.
  // Return null — commands will start fresh.
  return null;
}

function _clearDirectState() {
  try { fs.unlinkSync(STATE_FILE); } catch (_) {}
}

async function _getDirectPage(lib, isMobile, headless) {
  // In direct mode, each command is a fresh browser.
  // This is the main reason to use daemon mode instead.
  const { browser, page } = await lib.launchFreeman({ mobile: isMobile, headless });
  return page;
}

// ─── OUTPUT ────────────────────────────────────────────────────────────────────

function _output(data, flags) {
  if (flags.json || true) {
    // Always output JSON for machine consumption
    console.log(JSON.stringify(data, null, flags.pretty ? 2 : 0));
  }
}

// ─── RUN ───────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
