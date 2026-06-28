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
 *   node browser-freeman-cli.js cookies
 *   node browser-freeman-cli.js close
 *
 * Daemon mode (persistent browser):
 *   node browser-freeman-cli.js daemon [--mobile] [--desktop] [--headless]
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec, spawn } = require('child_process');
const os = require('os');

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
  cookies                    List all cookies
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
  --retry <n>                Number of retries on failure (default: 2)

EXAMPLES:
  node browser-freeman-cli.js open https://xueqiu.com
  node browser-freeman-cli.js snapshot --json
  node browser-freeman-cli.js click @e3
  node browser-freeman-cli.js fill "input[name=q]" "茅台"
  node browser-freeman-cli.js read https://mp.weixin.qq.com/s/xxxxx
  node browser-freeman-cli.js screenshot --annotate --path debug.png
  node browser-freeman-cli.js cookies
`.trim();

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DAEMON_PIPE_NAME = 'freeman-browser';
const DAEMON_SOCKET_PATH = process.platform === 'win32'
  ? `\\\\.\\pipe\\${DAEMON_PIPE_NAME}`
  : `/tmp/${DAEMON_PIPE_NAME}.sock`;

const PID_FILE = process.platform === 'win32'
  ? path.join(process.env.TEMP || os.tmpdir(), 'freeman-browser.pid')
  : '/tmp/freeman-browser.pid';

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

// ─── DAEMON HELPERS ───────────────────────────────────────────────────────────

async function isDaemonRunning() {
  return new Promise((resolve) => {
    // Check PID file first
    if (fs.existsSync(PID_FILE)) {
      try {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
        // Check if process is actually running
        if (process.platform === 'win32') {
          // On Windows, use tasklist
          exec(`tasklist /FI "PID eq ${pid}" /NH`, (err, stdout) => {
            if (stdout.includes(String(pid))) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
          return;
        }
        // On Unix, send signal 0
        try {
          process.kill(pid, 0);
          resolve(true);
        } catch (_) {
          resolve(false);
        }
      } catch (_) {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

async function startDaemon(opts = {}) {
  const lib = require(path.join(__dirname, 'browser-freeman'));

  // Check if daemon is already running
  if (await isDaemonRunning()) {
    console.log('[freeman-browser] Daemon already running');
    process.exit(0);
  }

  const mobile = opts.mobile || false;
  const desktop = opts.desktop || false;
  const headless = opts.headed ? false : true;

  console.log(`[freeman-browser] Starting daemon (mobile=${mobile}, headless=${headless})`);

  // Spawn daemon as detached process
  const scriptPath = path.join(__dirname, 'browser-freeman.js');
  const args = ['--daemon'];
  if (mobile) args.push('--mobile');
  if (desktop) args.push('--desktop');
  if (!headless) args.push('--headed');

  const child = spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();

  // Wait a bit for daemon to start
  await new Promise(r => setTimeout(r, 3000));

  if (await isDaemonRunning()) {
    console.log(`[freeman-browser] Daemon started successfully (PID: ${child.pid})`);
  } else {
    console.log('[freeman-browser] Failed to start daemon');
    process.exit(1);
  }
}

async function sendDaemonCommand(msg, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(DAEMON_SOCKET_PATH);
    conn.setTimeout(timeout);

    conn.on('connect', () => {
      conn.write(JSON.stringify(msg) + '\n');
    });

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

    conn.on('error', (err) => {
      reject(new Error(`Daemon connection failed: ${err.message}. Is the daemon running? Start it with: node browser-freeman-cli.js daemon`));
    });

    conn.on('timeout', () => {
      conn.destroy();
      reject(new Error('Daemon timeout'));
    });
  });
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const parsed = parseArgs(process.argv);
  const { command, positional, flags } = parsed;

  if (flags.help || !command) {
    console.log(HELP);
    process.exit(flags.help ? 0 : 1);
  }

  // ── DAEMON MODE: start persistent browser ──────────────────────────────────
  if (command === 'daemon') {
    await startDaemon({
      mobile: flags.mobile || false,
      desktop: flags.desktop || false,
      headed: flags.headed || false,
    });
    return;
  }

  // ── NON-DAEMON MODE: use daemon if running, otherwise direct ───────────────

  const daemonRunning = await isDaemonRunning();

  if (daemonRunning) {
    // Send command to daemon via IPC
    await _execViaDaemon(command, positional, flags);
  } else {
    // No daemon — execute directly (slower, starts browser each time)
    await _execDirect(command, positional, flags);
  }
}

// ─── EXEC VIA DAEMON ──────────────────────────────────────────────────────────

async function _execViaDaemon(command, positional, flags) {
  const buildMsg = (cmd, args = {}) => ({ command: cmd, args });
  const retries = parseInt(flags.retry) || 2;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let result;
      switch (command) {
        case 'open':
          result = await sendDaemonCommand(buildMsg('open', {
            url: positional[0],
            timeout: parseInt(flags.timeout) || 60000,
            waitUntil: flags.waitUntil || 'domcontentloaded',
          }));
          break;

        case 'snapshot':
          result = await sendDaemonCommand(buildMsg('snapshot', {
            includeNonInteractive: flags.full || false,
          }));
          break;

        case 'click':
          if (!positional[0]) { console.error('Usage: click <@ref|selector>'); process.exit(1); }
          const clickArg = positional[0].startsWith('@')
            ? { ref: positional[0] }
            : { selector: positional[0] };
          result = await sendDaemonCommand(buildMsg('click', clickArg));
          break;

        case 'fill':
          if (positional.length < 2) { console.error('Usage: fill <selector> <value>'); process.exit(1); }
          result = await sendDaemonCommand(buildMsg('fill', {
            selector: positional[0],
            value: positional.slice(1).join(' '),
          }));
          break;

        case 'read':
          result = await sendDaemonCommand(buildMsg('read', {
            url: positional[0],
            format: flags.format || 'text',
          }));
          break;

        case 'screenshot':
          result = await sendDaemonCommand(buildMsg('screenshot', {
            path: flags.path || `freeman-${Date.now()}.png`,
            annotate: !!flags.annotate,
            fullPage: !!flags.fullPage,
          }));
          break;

        case 'save-session':
          result = await sendDaemonCommand(buildMsg('save-session', {
            path: positional[0] || 'session.json',
          }));
          break;

        case 'load-session':
          result = await sendDaemonCommand(buildMsg('load-session', {
            path: positional[0] || 'session.json',
          }));
          break;

        case 'cookies':
          result = await sendDaemonCommand(buildMsg('cookies'));
          break;

        case 'evaluate':
          result = await sendDaemonCommand(buildMsg('evaluate', {
            script: positional.join(' '),
          }));
          break;

        case 'html':
          result = await sendDaemonCommand(buildMsg('html'));
          break;

        case 'text':
          result = await sendDaemonCommand(buildMsg('text'));
          break;

        case 'url':
          result = await sendDaemonCommand(buildMsg('url'));
          break;

        case 'title':
          result = await sendDaemonCommand(buildMsg('title'));
          break;

        case 'close':
          result = await sendDaemonCommand(buildMsg('close'));
          break;

        default:
          console.error(`Unknown command: ${command}`);
          console.error('Run with --help for usage.');
          process.exit(1);
      }

      _output(result, flags);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.error(`[retry] Attempt ${attempt + 1} failed, retrying... (${err.message})`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.error(`❌ Error: ${lastError.message}`);
  process.exit(1);
}

// ─── EXEC DIRECT (no daemon) ──────────────────────────────────────────────────

async function _execDirect(command, positional, flags) {
  const lib = require(path.join(__dirname, 'browser-freeman'));
  const mobile = flags.mobile || false;
  const desktop = flags.desktop || false;
  const headless = flags.headed ? false : true;
  const isMobile = mobile && !desktop;
  const retries = parseInt(flags.retry) || 2;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let result;
      switch (command) {
        case 'open': {
          const { browser, page } = await lib.launchFreeman({ mobile: isMobile, headless });
          await page.goto(positional[0], { waitUntil: 'domcontentloaded', timeout: parseInt(flags.timeout) || 60000 });
          await lib.sleep(1000);
          result = { url: page.url(), title: await page.title() };
          _output(result, flags);
          // Note: browser stays open in this process only (not shared across CLI invocations)
          // For persistence, use daemon mode
          break;
        }

        case 'snapshot': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          await page.goto(positional[0] || 'about:blank', { waitUntil: 'domcontentloaded' });
          const snap = await lib.snapshot(page, { includeNonInteractive: flags.full || false });
          _output(snap, flags);
          break;
        }

        case 'click': {
          if (!positional[0]) { console.error('Usage: click <@ref|selector>'); process.exit(1); }
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          if (positional[0].startsWith('@')) {
            const snap = await lib.snapshot(page);
            const el = snap.refs[positional[0]];
            if (!el) { console.error(`Ref ${positional[0]} not found. Run 'snapshot' first.`); process.exit(1); }
            await lib.humanClick(page, el.rect.x + el.rect.width / 2, el.rect.y + el.rect.height / 2);
          } else {
            await page.click(positional[0]);
          }
          await lib.sleep(500);
          result = { url: page.url(), title: await page.title() };
          _output(result, flags);
          break;
        }

        case 'fill': {
          if (positional.length < 2) { console.error('Usage: fill <selector> <value>'); process.exit(1); }
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          await lib.humanType(page, positional[0], positional.slice(1).join(' '));
          result = { ok: true };
          _output(result, flags);
          break;
        }

        case 'read': {
          result = await lib.readUrl(positional[0], {
            format: flags.format || 'text',
            headless,
            timeout: parseInt(flags.timeout) || 60000,
          });
          _output(result, flags);
          break;
        }

        case 'screenshot': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          const p = flags.path || `freeman-${Date.now()}.png`;
          if (flags.annotate) {
            result = await lib.annotateScreenshot(page, p, flags);
            _output(result, flags);
          } else {
            await page.screenshot({ path: p, fullPage: !!flags.fullPage });
            _output({ path: p }, flags);
          }
          break;
        }

        case 'save-session': {
          const { browser } = await lib.launchFreeman({ mobile: isMobile, headless });
          const ctx = browser.contexts()[0];
          await lib.saveSession(ctx, positional[0] || 'session.json');
          result = { ok: true };
          _output(result, flags);
          break;
        }

        case 'load-session': {
          const p = positional[0] || 'session.json';
          const { browser } = await lib.launchFreeman({ mobile: isMobile, headless });
          const ctx = await lib.loadSession(browser, p);
          const page = await ctx.newPage();
          result = { loaded: p };
          _output(result, flags);
          break;
        }

        case 'cookies': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          const cookies = await page.context().cookies();
          _output({ cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })) }, flags);
          break;
        }

        case 'evaluate': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          const evalResult = await page.evaluate(positional.join(' '));
          _output({ result: evalResult }, flags);
          break;
        }

        case 'html': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          _output({ html: await page.content() }, flags);
          break;
        }

        case 'text': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          _output({ text: await page.textContent('body') }, flags);
          break;
        }

        case 'url': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          _output({ url: page.url() }, flags);
          break;
        }

        case 'title': {
          const { page } = await lib.launchFreeman({ mobile: isMobile, headless });
          _output({ title: await page.title() }, flags);
          break;
        }

        case 'close':
          result = { closed: true };
          _output(result, flags);
          break;

        default:
          console.error(`Unknown command: ${command}`);
          console.error('Run with --help for usage.');
          process.exit(1);
      }

      return; // Success, exit retry loop
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.error(`[retry] Attempt ${attempt + 1} failed, retrying... (${err.message})`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.error(`❌ Error: ${lastError.message}`);
  process.exit(1);
}

// ─── OUTPUT ────────────────────────────────────────────────────────────────────

function _output(data, flags) {
  if (flags.json || true) {
    console.log(JSON.stringify(data, null, flags.pretty ? 2 : 0));
  }
}

// ─── RUN ───────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
