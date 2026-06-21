const { launchFreeman } = require('./scripts/browser-freeman');

(async () => {
  const { browser, page, sleep } = await launchFreeman({ mobile: false });

  await page.goto('http://192.168.1.133:5678/admin', { waitUntil: 'networkidle' });
  await sleep(1000);

  const username = process.env.ADMIN_USER || 'swm';
  const password = process.env.ADMIN_PASS || 'Swm328328';
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await sleep(3000);

  await page.click('text=Models');
  await sleep(2000);

  // 启用 opencode-zen 的禁用模型
  await page.selectOption('#modelProviderSelect', 'opencode-zen');
  await sleep(2000);

  // 查找并点击所有禁用状态的启用按钮
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#modelsTableBody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      const status = cells[2]?.textContent?.trim();
      const btn = row.querySelector('button');
      if (status === '已禁用' && btn) {
        btn.click();
      }
    });
  });
  console.log('Enabled all disabled models in opencode-zen');
  await sleep(2000);

  // 启用 openrouter 的禁用模型
  await page.selectOption('#modelProviderSelect', 'openrouter');
  await sleep(2000);

  await page.evaluate(() => {
    const rows = document.querySelectorAll('#modelsTableBody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      const status = cells[2]?.textContent?.trim();
      const btn = row.querySelector('button');
      if (status === '已禁用' && btn) {
        btn.click();
      }
    });
  });
  console.log('Enabled all disabled models in openrouter');
  await sleep(2000);

  // 最终检查所有模型状态
  const providers = ['sensenova', 'longcat', 'aihubmix', 'nvidia-nim', 'opencode-zen', 'openrouter'];
  const allModels = {};

  for (const provider of providers) {
    await page.selectOption('#modelProviderSelect', provider);
    await sleep(1500);

    const models = await page.evaluate(() => {
      const rows = document.querySelectorAll('#modelsTableBody tr');
      return Array.from(rows).map(row => {
        const cells = row.querySelectorAll('td');
        return {
          id: cells[0]?.textContent?.trim(),
          status: cells[2]?.textContent?.trim()
        };
      }).filter(m => m.id);
    });

    allModels[provider] = models;
  }

  console.log('\\n最终状态:');
  console.log(JSON.stringify(allModels, null, 2));

  // 统计
  let disabledCount = 0;
  Object.values(allModels).forEach(models => {
    models.forEach(m => {
      if (m.status === '已禁用') disabledCount++;
    });
  });
  console.log('\\n剩余禁用模型数:', disabledCount);

  await browser.close();
})();