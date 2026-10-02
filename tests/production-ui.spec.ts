import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
// 验证生产静态包不会暴露演示入口；不提交真实配对码。
test('正式后台只显示中文配对登录且窄屏无溢出', async ({ page }) => {
  const errors: string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.PRODUCTION_PREVIEW_URL || 'http://127.0.0.1:4327');
  await expect(page).toHaveTitle('栖岸 · 房产协作');
  await expect(page.getByRole('heading',{name:'栖岸管理后台'})).toBeVisible();
  await expect(page.getByLabel('管理员配对码')).toBeVisible();
  await expect(page.getByLabel('切换角色')).toHaveCount(0);
  await page.getByLabel('管理员配对码').fill('123');
  await page.getByRole('button',{name:'配对登录',exact:true}).click();
  await expect(page.getByLabel('管理员配对码')).toHaveValue('123');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  const directory = process.env.QA_SCREENSHOT_DIR || join(tmpdir(), 'qian-estate-qa');
  await mkdir(directory, { recursive: true });
  await page.screenshot({path:join(directory,`后台登录-${test.info().project.name}.png`),fullPage:true});
});
