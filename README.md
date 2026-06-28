# 🕵️ Freeman Browser (v2.0)

> Stealth browser for AI agents. Bypass anti-bot detection with human-like fingerprints.
> Optimized for Xueqiu (雪球) and WeChat (微信公众号).

Freeman Browser 是一个基于 Playwright 的隐身浏览器，专为 AI Agent 设计。它让自动化脚本看起来像一个真实的用户在浏览网页，从而绕过 Cloudflare、DataDome 等反爬检测系统。

---

## ✨ 特性

- 🎭 **双模式指纹伪装** — iPhone 15 Pro (Safari) 或 Desktop Chrome，一键切换
- 🖱️ **人类行为模拟** — 贝塞尔曲线鼠标轨迹、随机打字延迟、自然滚动、阅读停顿
- 🧩 **滑块验证码自动识别与破解** — 支持阿里/雪球、极验(GeeTest)、通用滑块（误判率极低）
- 🔑 **2CAPTCHA 集成** — 自动解决 reCAPTCHA v2/v3、hCaptcha、Cloudflare Turnstile
- 🌑 **Shadow DOM 穿透** — 深度遍历 Web Components，定位表单元素
- ✏️ **富文本编辑器支持** — 剪贴板粘贴方式，兼容 Lexical、ProseMirror, Quill, Draft.js
- 📰 **文章抓取** — 雪球、微信公众号、通用网页，自动处理验证码
  - 雪球：API 直连优先（`statuses/original/show.json`），15+ 自适应选择器
  - 微信：环境检测绕过，10+ 自适应选择器，日期正则提取
- 🛡️ **反检测措施 v2.0**：
  - 60+ Chromium 启动参数（禁用自动化特征）
  - DNS-over-HTTPS 防止 DNS 泄漏
  - 50+ 广告/追踪域名自动拦截
  - Canvas/WebGL 指纹噪声
  - WebRTC 防泄漏
  - 性能计时噪声 + 电池/媒体设备伪装
  - 完整的 Client Hints + Sec-Fetch 头部
- 🔄 **智能导航** — `smartNavigate()` 内置重试 + 验证码自动处理
- 🖥️ **CLI + Daemon** — 持久化浏览器守护进程，零启动开销

---

## 📦 安装

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium
```

**Node.js >= 18.0.0**  required。

---

## 🚀 快速开始

```js
const { launchFreeman } = require('./scripts/browser-freeman');

// 默认：iPhone 15 Pro 模式
const { browser, page, humanType, humanScroll, sleep } = await launchFreeman();

// 桌面模式：Chrome 136
const { browser, page } = await launchFreeman({ mobile: false });

// 访问网站 — 自动绕过反爬
await page.goto('https://any-protected-site.com');
```

### 雪球文章抓取

```js
const { fetchXueqiuArticle } = require('./scripts/browser-freeman');

const result = await fetchXueqiuArticle('https://xueqiu.com/123456/789012');
console.log(result.data.title);
console.log(result.data.textContent);
```

### 微信公众号抓取

```js
const { fetchWechatArticle } = require('./scripts/browser-freeman');

const article = await fetchWechatArticle('https://mp.weixin.qq.com/s/xxxxx');
console.log(article.data.title);
console.log(article.data.author);
```

---

## 🎭 指纹伪装详情

### Mobile 模式（默认）

| 属性 | 伪装值 |
|------|--------|
| User-Agent | iPhone 15 Pro, iOS 17.4.1, Safari |
| Viewport | 393×852, deviceScaleFactor=3 |
| Touch Points | 5 |
| Vendor | Apple Computer, Inc. |
| Platform | iPhone |
| Client Hints | sec-ch-ua-mobile: ?1, platform: iOS |

### Desktop 模式

| 属性 | 伪装值 |
|------|--------|
| User-Agent | Chrome/136.0.0.0, Windows 10 |
| Viewport | 1440×900 |
| Vendor | Google Inc. |
| Platform | Win32 |
| Client Hints | sec-ch-ua, sec-ch-ua-mobile: ?0, platform: Windows |

### 反检测措施

- ✅ `navigator.webdriver` → `false`
- ✅ Canvas 指纹噪声（LSB 翻转 + fillText 微位移 + getImageData 噪声）
- ✅ WebGL 指纹伪装（Intel Iris OpenGL Engine）
- ✅ `navigator.plugins` / `mimeTypes` 伪装
- ✅ `screen` 属性与 viewport 匹配
- ✅ `navigator.connection` 伪装
- ✅ HTTP Client Hints + Sec-Fetch 头部完整设置
- ✅ 60+ Chromium 启动参数禁用自动化特征
- ✅ DNS-over-HTTPS 防止 DNS 泄漏
- ✅ 50+ 广告/追踪域名自动拦截
- ✅ WebRTC 防泄漏
- ✅ 性能计时噪声 + 电池/媒体设备伪装
- ✅ `appCodeName` / `appName` / `product` 伪装

---

## 🖱️ 人类行为 API

```js
const { page, humanClick, humanType, humanScroll, humanRead, sleep } = await launchFreeman();

// 🖱️ 点击 — 贝塞尔曲线移动鼠标后点击
await humanClick(page, x, y);

// ⌨️ 打字 — 60-220ms/字符 + 随机停顿
await humanType(page, 'input[name="email"]', 'user@example.com');

// 📜 滚动 — 平滑步进 + 抖动
await humanScroll(page, 'down');  // 或 'up'

// 📖 阅读 — 模拟阅读停顿 (1.5-4秒)
await humanRead(page);

// ⏱️ 等待
await sleep(1500);
```

---

## 🧩 滑块验证码

```js
// 自动检测并解决滑块验证码
const { detectSliderCaptcha, solveSliderCaptcha, handleSliderCaptcha } = require('./scripts/browser-freeman');

// 检测页面是否有滑块
const info = await detectSliderCaptcha(page);

// 尝试解决
const solved = await solveSliderCaptcha(page, { maxRetries: 3 });

// 等待并自动处理（轮询模式）
await handleSliderCaptcha(page, { timeout: 10000 });
```

支持的验证码类型：
- 阿里/雪球（nc_container）
- 极验 GeeTest
- 通用滑块（自动识别宽条形元素）
- 智能降误判：结合光标样式、尺寸、背景色、圆角、overflow 综合判断

---

## 🔑 CAPTCHA 解决（2captcha）

```js
const { solveCaptcha } = require('./scripts/browser-freeman');

// 自动检测页面上的 CAPTCHA 类型并解决
const { token, type } = await solveCaptcha(page, {
  apiKey: process.env.TWOCAPTCHA_KEY,  // 或直接传入
  action: 'verify',
  minScore: 0.7,
});

// 然后提交表单
await page.click('button[type=submit]');
```

支持类型：reCAPTCHA v2/v3、hCaptcha、Cloudflare Turnstile

---

## 🌑 Shadow DOM 穿透

```js
const { shadowQuery, shadowFill, shadowClickButton, dumpInteractiveElements } = require('./scripts/browser-freeman');

// 深度查找 Shadow DOM 中的元素
await shadowQuery(page, 'input[name="username"]');

// 填充 Shadow DOM 输入框
await shadowFill(page, 'input[name="username"]', 'myuser');

// 点击 Shadow DOM 按钮（按文本）
await shadowClickButton(page, 'Submit');

// 导出所有可交互元素（含 Shadow DOM）— 调试用
const elements = await dumpInteractiveElements(page);
console.log(elements);
```

---

## ✏️ 富文本编辑器

```js
const { pasteIntoEditor } = require('./scripts/browser-freeman');

// 通过剪贴板粘贴 — 兼容所有富文本编辑器
await pasteIntoEditor(page, '[data-lexical-editor]', 'Hello World!');
```

常见编辑器选择器：

| 编辑器 | 选择器 |
|--------|--------|
| Lexical (Reddit, Meta) | `[data-lexical-editor]` |
| Draft.js (Twitter) | `.public-DraftEditor-content` |
| Quill | `.ql-editor` |
| ProseMirror (Linear) | `.ProseMirror` |
| 通用 | `[contenteditable="true"]` |

---

## 📰 文章抓取

```js
const { fetchArticle } = require('./scripts/browser-freeman');

// 自动识别平台（雪球/微信/通用）
const result = await fetchArticle('https://xueqiu.com/123456/789012');
console.log(result.data.title);
console.log(result.data.textContent);

// 或指定平台
const { fetchXueqiuArticle, fetchWechatArticle } = require('./scripts/browser-freeman');
const xueqiu = await fetchXueqiuArticle(url);
const wechat = await fetchWechatArticle(url);
```

返回数据结构：

```js
{
  success: true,
  url: 'https://...',
  data: {
    title: '文章标题',
    author: '作者',
    content: '<p>HTML 内容</p>',
    textContent: '纯文本内容',
    publishTime: '发布时间',
    source: '来源',  // 仅微信
  }
}
```

---

## ⚙️ 配置

在项目根目录创建 `browser.json` 自定义地理位置和语言：

```json
{
  "locale": "zh-CN",
  "timezoneId": "Asia/Shanghai",
  "geolocation": {
    "latitude": 31.2304,
    "longitude": 121.4737,
    "accuracy": 50
  },
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "bypass": ["localhost", "127.0.0.1"],
    "username": "user",
    "password": "pass"
  }
}
```

也可通过环境变量 `BROWSER_CONFIG` 指定配置文件路径。

---

## 🧪 测试

```bash
# 基础连接测试（IP 信息）
node scripts/browser-freeman.js https://ipinfo.io/json

# 测试雪球文章抓取
node scripts/browser-freeman.js https://xueqiu.com/123456/789012

# 启动 daemon
node scripts/browser-freeman-cli.js daemon --headless
```

---

## 📁 项目结构

```
freeman-browser/
├── SKILL.md                    # AI Agent 技能说明文档
├── README.md                   # 本文件
├── meta.json                   # 项目元数据
├── package.json                # 依赖声明
├── enable_models.js            # 示例：自动化模型启用脚本
└── scripts/
    ├── browser-freeman.js      # 🔧 核心引擎（~2600 行）
    └── browser-freeman-cli.js  # 🖥️ CLI 入口（~700 行）
```

---

## ⚠️ 免责声明

本项目仅供学习研究和合法自动化测试使用。请遵守目标网站的服务条款和 robots.txt 规则。使用者需自行承担因不当使用而产生的法律责任。

---

## 📄 License

MIT
