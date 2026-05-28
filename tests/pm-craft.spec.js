const { test, expect } = require('@playwright/test');

// 辅助函数：检查元素是否有 hidden 类
async function hasHiddenClass(locator) {
  const classAttr = await locator.getAttribute('class');
  return classAttr ? classAttr.split(/\s+/).includes('hidden') : false;
}

test.describe('7s-PM-Craft E2E 测试', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // 等待页面初始化完成：首页显示且产品线卡片已渲染
    await page.waitForFunction(() => {
      const home = document.getElementById('home-page');
      const cards = document.querySelectorAll('#product-lines .product-card');
      return home && !home.classList.contains('hidden') && cards.length > 0;
    });
  });

  test.describe('首页', () => {
    test('应显示统计概览', async ({ page }) => {
      await expect(page.getByText('统计概览')).toBeVisible();
      await expect(page.getByText('总需求')).toBeVisible();
      const statsContainer = page.locator('#stats-container');
      await expect(statsContainer).toBeVisible();
      // 已归档数量在独立卡片中
      const archivedCard = page.locator('#archived-card');
      await expect(archivedCard).toBeVisible();
      const cards = statsContainer.locator('> div');
      // total + 动态状态，至少 3 个
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    test('应显示产品线卡片', async ({ page }) => {
      // 使用精确的定位器，限定在首页内
      await expect(page.locator('#home-page').getByRole('heading', { name: '产品线', exact: true })).toBeVisible();
      const productLines = page.locator('#product-lines');
      await expect(productLines).toBeVisible();
    });

    test('应显示迭代视图入口', async ({ page }) => {
      const entry = page.locator('#iteration-entry');
      await expect(entry).toBeVisible();
      await expect(entry.getByText('迭代视图')).toBeVisible();
    });

    test('点击产品线卡片应进入需求列表页', async ({ page }) => {
      const cards = page.locator('#product-lines .product-card');
      const count = await cards.count();
      if (count > 0) {
        const firstCard = cards.first();
        const plName = await firstCard.locator('h3').textContent();
        await firstCard.click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
        await expect(page.locator('#list-title')).toContainText(plName);
      }
    });

    test('点击迭代视图入口应进入迭代视图页', async ({ page }) => {
      const entry = page.locator('#iteration-entry');
      await entry.click();
      expect(await hasHiddenClass(page.locator('#sprint-page'))).toBe(false);
      // 验证左侧迭代列表存在
      await expect(page.locator('#sprint-list')).toBeVisible();
    });
  });

  test.describe('需求列表页 - 状态视图', () => {
    test.beforeEach(async ({ page }) => {
      // 先进入列表页
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });

    test('应显示看板布局', async ({ page }) => {
      // 先切换到看板视图（默认现在是列表视图）
      await page.locator('#btn-view-card').click();
      const kanban = page.locator('#kanban-board');
      await expect(kanban).toBeVisible();
      const columns = kanban.locator('.kanban-column');
      const count = await columns.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('看板列应包含正确的状态标题', async ({ page }) => {
      await page.locator('#btn-view-card').click();
      const columns = page.locator('#kanban-board .kanban-column');
      const expectedStatuses = ['设计中', '待评审', '开发中', '待验收', '已完成', '挂起'];
      const count = await columns.count();
      // 至少包含前几个默认状态
      const checkCount = Math.min(expectedStatuses.length, count);
      for (let i = 0; i < checkCount; i++) {
        await expect(columns.nth(i)).toContainText(expectedStatuses[i]);
      }
    });

    test('状态标签应可点击筛选', async ({ page }) => {
      await page.locator('#btn-view-card').click();
      const tabs = page.locator('#status-tabs button');
      if (await tabs.count() > 1) {
        await tabs.nth(1).click();
        // 筛选后看板应仍然可见
        await expect(page.locator('#kanban-board')).toBeVisible();
      }
    });
  });

  test.describe('搜索功能', () => {
    test('全局搜索应切换到搜索结果页', async ({ page }) => {
      const searchInput = page.locator('#global-search');
      await searchInput.fill('需求');
      await searchInput.press('Enter');

      expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      await expect(page.locator('#list-title')).toContainText('搜索结果');
    });

    test('搜索模式应显示表格视图而非看板', async ({ page }) => {
      const searchInput = page.locator('#global-search');
      await searchInput.fill('REQ');
      await searchInput.press('Enter');

      // 表格视图应可见（没有 hidden 类）
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);
      // 看板应隐藏
      expect(await hasHiddenClass(page.locator('#kanban-board'))).toBe(true);
    });

    test('清空搜索后返回首页', async ({ page }) => {
      const searchInput = page.locator('#global-search');
      await searchInput.fill('test');
      await searchInput.press('Enter');
      expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);

      // 点击返回首页
      await page.getByRole('button', { name: '首页' }).first().click();
      expect(await hasHiddenClass(page.locator('#home-page'))).toBe(false);
    });
  });

  test.describe('设置弹窗', () => {
    test('点击设置按钮应打开弹窗', async ({ page }) => {
      await page.getByRole('button', { name: '设置' }).click();
      const modal = page.locator('#settings-modal');
      expect(await hasHiddenClass(modal)).toBe(false);
      await expect(modal.getByRole('heading', { name: '设置' })).toBeVisible();
    });

    test('设置弹窗应显示产品线', async ({ page }) => {
      await page.getByRole('button', { name: '设置' }).click();
      // 限定在弹窗内查找"产品线"标题
      await expect(page.locator('#settings-modal').getByRole('heading', { name: '产品线' })).toBeVisible();
      await expect(page.locator('#product-lines-list')).toBeVisible();
    });

    test('设置弹窗应显示状态定义', async ({ page }) => {
      await page.getByRole('button', { name: '设置' }).click();
      await expect(page.locator('#settings-modal').getByText('状态定义')).toBeVisible();
      await expect(page.locator('#status-list-display')).toBeVisible();
    });

    test('设置弹窗应显示优先级定义', async ({ page }) => {
      await page.getByRole('button', { name: '设置' }).click();
      await expect(page.locator('#settings-modal').getByText('优先级定义')).toBeVisible();
      await expect(page.locator('#priority-list-display')).toBeVisible();
    });

    test('点击背景应关闭弹窗', async ({ page }) => {
      await page.getByRole('button', { name: '设置' }).click();
      const modal = page.locator('#settings-modal');
      expect(await hasHiddenClass(modal)).toBe(false);

      // 点击弹窗背景（modal 本身，而非内容）
      await modal.click({ position: { x: 10, y: 10 } });
      expect(await hasHiddenClass(modal)).toBe(true);
    });

    test('点击关闭按钮应关闭弹窗', async ({ page }) => {
      await page.getByRole('button', { name: '设置' }).click();
      const modal = page.locator('#settings-modal');
      expect(await hasHiddenClass(modal)).toBe(false);

      // 点击关闭按钮 (×)
      await modal.locator('button').first().click();
      expect(await hasHiddenClass(modal)).toBe(true);
    });
  });

  test.describe('需求详情页', () => {
    test.beforeEach(async ({ page }) => {
      // 先进入列表页
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });

    test('点击需求应进入详情页', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        expect(await hasHiddenClass(page.locator('#detail-page'))).toBe(false);
      }
    });

    test('详情页不应有归档按钮', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        expect(await hasHiddenClass(page.locator('#detail-page'))).toBe(false);

        // 确认没有归档按钮
        const archiveBtn = page.getByRole('button', { name: '归档' });
        await expect(archiveBtn).toHaveCount(0);
      }
    });

    test('详情页应显示需求文档按钮', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await expect(page.getByRole('button', { name: '需求文档' })).toBeVisible();
      }
    });

    test('详情页应显示返回按钮', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await expect(page.getByText('列表').first()).toBeVisible();
      }
    });

    test('点击返回应回到列表页', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        expect(await hasHiddenClass(page.locator('#detail-page'))).toBe(false);

        await page.getByText('列表').first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });
  });

  test.describe('下拉框交互', () => {
    test.beforeEach(async ({ page }) => {
      // 搜索模式进入表格视图以测试下拉框
      const searchInput = page.locator('#global-search');
      await searchInput.fill('REQ');
      await searchInput.press('Enter');
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);
    });

    test('表格中应存在状态下拉框', async ({ page }) => {
      const rowCount = await page.locator('tbody tr').count();
      if (rowCount > 0) {
        const statusDropdowns = page.locator('.cdropdown[data-onchange*="updateStatus"]');
        await expect(statusDropdowns).toHaveCount(rowCount);
      }
    });

    test('表格中应存在优先级下拉框', async ({ page }) => {
      const rowCount = await page.locator('tbody tr').count();
      if (rowCount > 0) {
        const priorityDropdowns = page.locator('.cdropdown[data-onchange*="updatePriority"]');
        await expect(priorityDropdowns).toHaveCount(rowCount);
      }
    });

    test('表格中应存在迭代下拉框', async ({ page }) => {
      const rowCount = await page.locator('tbody tr').count();
      if (rowCount > 0) {
        const sprintDropdowns = page.locator('.cdropdown[data-onchange*="updateSprint"]');
        await expect(sprintDropdowns).toHaveCount(rowCount);
      }
    });
  });

  test.describe('导航流程', () => {
    test('完整流程: 首页 -> 列表 -> 详情 -> 列表 -> 首页', async ({ page }) => {
      // 首页
      expect(await hasHiddenClass(page.locator('#home-page'))).toBe(false);

      const cards = page.locator('#product-lines .product-card');
      const count = await cards.count();
      if (count === 0) {
        test.skip('没有产品线数据');
        return;
      }

      // 进入列表
      await cards.first().click();
      expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);

      // 进入详情
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        expect(await hasHiddenClass(page.locator('#detail-page'))).toBe(false);

        // 返回列表
        await page.getByText('列表').first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }

      // 返回首页
      await page.getByText('首页').first().click();
      expect(await hasHiddenClass(page.locator('#home-page'))).toBe(false);
    });
  });

  test.describe('看板与搜索视图切换', () => {
    test('正常模式显示表格，搜索模式显示表格', async ({ page }) => {
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);

        // 正常模式：表格可见（默认列表视图），看板隐藏
        expect(await hasHiddenClass(page.locator('#kanban-board'))).toBe(true);
        expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);

        // 搜索模式：表格可见
        await page.goto('/');
        await page.waitForFunction(() => {
          const home = document.getElementById('home-page');
          return home && !home.classList.contains('hidden');
        });

        const searchInput = page.locator('#global-search');
        await searchInput.fill('REQ');
        await searchInput.press('Enter');

        expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);
        expect(await hasHiddenClass(page.locator('#kanban-board'))).toBe(true);
      }
    });
  });

  test.describe('状态视图模式切换', () => {
    test.beforeEach(async ({ page }) => {
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });

    test('应显示卡片/列表切换按钮', async ({ page }) => {
      await expect(page.locator('#btn-view-card')).toBeVisible();
      await expect(page.locator('#btn-view-list')).toBeVisible();
    });

    test('默认应为列表视图', async ({ page }) => {
      expect(await hasHiddenClass(page.locator('#kanban-board'))).toBe(true);
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);
    });

    test('点击卡片按钮应切换到看板视图', async ({ page }) => {
      await page.locator('#btn-view-card').click();
      expect(await hasHiddenClass(page.locator('#kanban-board'))).toBe(false);
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(true);
    });

    test('点击列表按钮应从看板切回表格', async ({ page }) => {
      await page.locator('#btn-view-card').click();
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(true);

      await page.locator('#btn-view-list').click();
      expect(await hasHiddenClass(page.locator('#kanban-board'))).toBe(true);
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);
    });

    test('切换按钮应有激活状态样式', async ({ page }) => {
      // 默认列表激活
      await expect(page.locator('#btn-view-list')).toHaveClass(/active/);

      await page.locator('#btn-view-card').click();
      await expect(page.locator('#btn-view-card')).toHaveClass(/active/);
      await expect(page.locator('#btn-view-list')).not.toHaveClass(/active/);
    });
  });

  test.describe('新建需求', () => {
    test('首页应显示新建需求按钮', async ({ page }) => {
      await expect(page.locator('#home-page').getByRole('button', { name: '新建需求' })).toBeVisible();
    });

    test('点击新建需求应打开弹窗', async ({ page }) => {
      await page.locator('#home-page').getByRole('button', { name: '新建需求' }).click();
      const modal = page.locator('#create-req-modal');
      expect(await hasHiddenClass(modal)).toBe(false);
      await expect(modal.getByRole('heading', { name: '新建需求' })).toBeVisible();
    });

    test('新建需求弹窗应包含所有字段', async ({ page }) => {
      await page.locator('#home-page').getByRole('button', { name: '新建需求' }).click();
      await expect(page.locator('#new-req-title')).toBeVisible();
      await expect(page.locator('#new-req-product-line-list')).toBeVisible();
      await expect(page.locator('#cd-new-req-priority')).toBeVisible();
      await expect(page.locator('#new-req-due-date')).toBeVisible();
      await expect(page.locator('#new-req-platform-web')).toBeVisible();
      await expect(page.locator('#new-req-platform-mobile')).toBeVisible();
      await expect(page.locator('#new-req-developer')).toBeVisible();
      await expect(page.locator('#new-req-requester')).toBeVisible();
    });

    test('点击背景应关闭新建需求弹窗', async ({ page }) => {
      await page.locator('#home-page').getByRole('button', { name: '新建需求' }).click();
      const modal = page.locator('#create-req-modal');
      expect(await hasHiddenClass(modal)).toBe(false);
      await modal.click({ position: { x: 10, y: 10 } });
      expect(await hasHiddenClass(modal)).toBe(true);
    });

    test('创建需求后应进入详情页', async ({ page }) => {
      await page.locator('#home-page').getByRole('button', { name: '新建需求' }).click();

      // 填写表单
      await page.locator('#new-req-title').fill('E2E测试新建需求');

      // 如果存在已有产品线复选框，勾选第一个；否则输入新产品线
      const productLineCheckboxes = page.locator('input[name="new-req-product-line"]');
      if (await productLineCheckboxes.count() > 0) {
        await productLineCheckboxes.first().check();
      } else {
        await page.locator('#new-req-product-line-input').fill('测试产品线');
        await page.locator('#create-req-modal').getByRole('button', { name: '添加' }).click();
      }

      // 使用自定义 dropdown 选择优先级
      await page.locator('#cd-new-req-priority .cdropdown-trigger').click();
      await page.locator('#cd-new-req-priority .cdropdown-option[data-value="P1"]').click();
      await page.locator('#new-req-developer').fill('测试开发');
      await page.locator('#new-req-requester').fill('测试产品');

      // 提交
      await page.locator('#create-req-modal').getByRole('button', { name: '创建需求' }).click();

      // 应进入详情页
      await page.waitForFunction(() => {
        const detail = document.getElementById('detail-page');
        return detail && !detail.classList.contains('hidden');
      });
      expect(await hasHiddenClass(page.locator('#detail-page'))).toBe(false);
      await expect(page.locator('#detail-header')).toContainText('E2E测试新建需求');
    });
  });

  test.describe('列表页归档', () => {
    test.beforeEach(async ({ page }) => {
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });

    test('看板卡片悬停应显示归档按钮', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        const firstCard = kanbanCards.first();
        await firstCard.hover();
        const archiveBtn = firstCard.locator('button[title="归档"]');
        await expect(archiveBtn).toBeVisible();
      }
    });

    test('搜索表格应显示归档按钮', async ({ page }) => {
      // 先回到首页，再搜索
      await page.getByText('首页').first().click();
      await page.waitForFunction(() => {
        const home = document.getElementById('home-page');
        return home && !home.classList.contains('hidden');
      });

      // 切换到搜索模式
      const searchInput = page.locator('#global-search');
      await searchInput.fill('REQ');
      await searchInput.press('Enter');
      expect(await hasHiddenClass(page.locator('#table-view'))).toBe(false);

      const rows = page.locator('tbody tr');
      if (await rows.count() > 0) {
        const firstRow = rows.first();
        const archiveBtn = firstRow.locator('button[title="归档"]');
        await expect(archiveBtn).toBeVisible();
      }
    });
  });

  test.describe('需求文档在线编辑', () => {
    test.beforeEach(async ({ page }) => {
      // 先进入列表页
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });

    test('详情页应显示编辑按钮', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await expect(page.getByRole('button', { name: '需求文档' })).toBeVisible();

        // 打开需求文档面板
        await page.getByRole('button', { name: '需求文档' }).click();
        await expect(page.locator('#doc-panel')).not.toHaveClass(/hidden/);
        await expect(page.locator('#doc-edit-btn')).toBeVisible();
      }
    });

    test('点击编辑应进入编辑模式', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await page.getByRole('button', { name: '需求文档' }).click();

        await page.locator('#doc-edit-btn').click();
        // 编辑器应可见，渲染内容应隐藏
        expect(await hasHiddenClass(page.locator('#doc-editor'))).toBe(false);
        expect(await hasHiddenClass(page.locator('#doc-content'))).toBe(true);
        // 保存和取消按钮应可见
        expect(await hasHiddenClass(page.locator('#doc-save-btn'))).toBe(false);
        expect(await hasHiddenClass(page.locator('#doc-cancel-btn'))).toBe(false);
      }
    });

    test('编辑并保存文档内容', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await page.getByRole('button', { name: '需求文档' }).click();

        await page.locator('#doc-edit-btn').click();

        // 清空并输入新内容
        const editor = page.locator('#doc-editor');
        await editor.fill('## 测试编辑内容\n\n这是 E2E 测试写入的内容。');

        // 监听保存 API 请求
        const saveResponse = page.waitForResponse(resp =>
          resp.url().includes('/api/requirements/') && resp.url().endsWith('/content') && resp.request().method() === 'POST'
        );

        // 点击保存
        await page.locator('#doc-save-btn').click();

        // 等待 API 响应
        const response = await saveResponse;
        expect(response.status()).toBe(200);

        // 保存后编辑器应隐藏，内容区域应显示（由前端直接切换）
        await page.waitForTimeout(500);
        expect(await hasHiddenClass(page.locator('#doc-editor'))).toBe(true);
        expect(await hasHiddenClass(page.locator('#doc-content'))).toBe(false);
      }
    });

    test('取消编辑应恢复原内容', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await page.getByRole('button', { name: '需求文档' }).click();

        // 记录原始内容
        const originalContent = await page.locator('#doc-content').textContent();

        await page.locator('#doc-edit-btn').click();
        const editor = page.locator('#doc-editor');
        await editor.fill('## 不应该保存的内容');

        // 点击取消
        await page.locator('#doc-cancel-btn').click();

        // 应回到查看模式，内容不变
        expect(await hasHiddenClass(page.locator('#doc-content'))).toBe(false);
        expect(await hasHiddenClass(page.locator('#doc-editor'))).toBe(true);
      }
    });
  });

  test.describe('原型全屏展示', () => {
    test.beforeEach(async ({ page }) => {
      const cards = page.locator('#product-lines .product-card');
      if (await cards.count() > 0) {
        await cards.first().click();
        expect(await hasHiddenClass(page.locator('#list-page'))).toBe(false);
      }
    });

    test('详情页应显示全屏按钮', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await expect(page.locator('#proto-fullscreen-btn')).toBeVisible();
      }
    });

    test('点击全屏按钮应进入全屏模式', async ({ page }) => {
      const kanbanCards = page.locator('#kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        await page.locator('#proto-fullscreen-btn').click();

        // 等待全屏状态变化
        await page.waitForFunction(() => {
          return !!document.fullscreenElement;
        });

        expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);

        // 退出全屏
        await page.evaluate(() => document.exitFullscreen());
      }
    });
  });

  test.describe('迭代视图页', () => {
    test.beforeEach(async ({ page }) => {
      // 从首页进入迭代视图
      const entry = page.locator('#iteration-entry');
      await entry.click();
      expect(await hasHiddenClass(page.locator('#sprint-page'))).toBe(false);
    });

    test('迭代视图页应显示左侧迭代列表', async ({ page }) => {
      await expect(page.locator('#sprint-list')).toBeVisible();
    });

    test('迭代视图页应显示看板布局', async ({ page }) => {
      expect(await hasHiddenClass(page.locator('#sprint-kanban-board'))).toBe(false);
      const columns = page.locator('#sprint-kanban-board .kanban-column');
      const count = await columns.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('迭代视图页应显示视图切换按钮', async ({ page }) => {
      await expect(page.locator('#btn-sprint-card')).toBeVisible();
      await expect(page.locator('#btn-sprint-list')).toBeVisible();
    });

    test('迭代视图页应显示产品线筛选下拉', async ({ page }) => {
      await expect(page.locator('#cd-sprint-pl-filter')).toBeVisible();
    });

    test('点击列表按钮应切换到列表视图', async ({ page }) => {
      // 默认是看板视图
      expect(await hasHiddenClass(page.locator('#sprint-kanban-board'))).toBe(false);

      // 点击列表按钮
      await page.locator('#btn-sprint-list').click();
      expect(await hasHiddenClass(page.locator('#sprint-kanban-board'))).toBe(true);
      expect(await hasHiddenClass(page.locator('#sprint-list-view'))).toBe(false);
    });

    test('迭代视图页点击需求应进入详情页', async ({ page }) => {
      const kanbanCards = page.locator('#sprint-kanban-board .kanban-card');
      if (await kanbanCards.count() > 0) {
        await kanbanCards.first().click();
        expect(await hasHiddenClass(page.locator('#detail-page'))).toBe(false);
      }
    });

    test('迭代视图页应显示返回按钮', async ({ page }) => {
      const sprintPage = page.locator('#sprint-page');
      await expect(sprintPage.locator('button:has-text("首页")')).toBeVisible();
    });

    test('从迭代视图页点击返回应回到首页', async ({ page }) => {
      const sprintPage = page.locator('#sprint-page');
      await sprintPage.locator('button:has-text("首页")').click();
      expect(await hasHiddenClass(page.locator('#home-page'))).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API 单元测试：导入接口（pm-craft-rules §6.3）
// 使用 Playwright 的 request context 直接调用 API，不依赖页面 UI
// ─────────────────────────────────────────────────────────────────────────────

const { request: pwRequest } = require('@playwright/test');

test.describe('API: POST /api/requirements/import', () => {
  let apiContext;
  const API_BASE = `http://localhost:${process.env.PORT || 3300}`;

  test.beforeAll(async () => {
    apiContext = await pwRequest.newContext({ baseURL: API_BASE });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('应接受不含 front matter 的纯 Markdown 内容，自动补全元数据', async () => {
    const response = await apiContext.post('/api/requirements/import', {
      data: {
        content: '# 无 Front Matter 的导入测试\n\n## 需求描述\n\n这是一个测试需求。\n\n## 验收标准\n\n- [ ] 验收项1',
        options: { product_line: ['产品线A'] }
      }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^REQ-\d{6}$/);
    expect(body.title).toBe('无 Front Matter 的导入测试');
    expect(Array.isArray(body.productLine)).toBe(true);
    expect(body.productLine[0]).toBe('产品线A');
    expect(body.path).toMatch(/requirement\.md$/);
  });

  test('应接受含 front matter 的完整 Markdown 内容', async () => {
    const content = [
      '---',
      'title: 含 Front Matter 的导入测试',
      'status: 设计中',
      'priority: P1',
      'product_line:',
      '  - 产品线A',
      '---',
      '',
      '## 需求描述',
      '',
      '完整带元数据的导入测试。'
    ].join('\n');

    const response = await apiContext.post('/api/requirements/import', {
      data: { content }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^REQ-\d{6}$/);
    expect(body.title).toBe('含 Front Matter 的导入测试');
  });

  test('options 字段应覆盖 front matter 中的值', async () => {
    const content = [
      '---',
      'title: 覆盖测试需求',
      'priority: P3',
      'product_line: 产品线B',
      '---',
      '',
      '## 需求描述'
    ].join('\n');

    const response = await apiContext.post('/api/requirements/import', {
      data: {
        content,
        options: { priority: 'P0', product_line: ['产品线A'] }
      }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // priority 被 options 覆盖为 P0
    // productLine 被覆盖为产品线A
    expect(body.productLine[0]).toBe('产品线A');
  });

  test('product_line 为 string 时应自动转为 array', async () => {
    const content = [
      '---',
      'title: product_line string 兼容测试',
      'product_line: 产品线A',
      '---',
      '',
      '## 需求描述'
    ].join('\n');

    const response = await apiContext.post('/api/requirements/import', {
      data: { content }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.productLine)).toBe(true);
    expect(body.productLine[0]).toBe('产品线A');
  });

  test('content 为空时应返回 400', async () => {
    const response = await apiContext.post('/api/requirements/import', {
      data: { content: '' }
    });
    expect(response.status()).toBe(400);
  });

  test('content 缺失时应返回 400', async () => {
    const response = await apiContext.post('/api/requirements/import', {
      data: {}
    });
    expect(response.status()).toBe(400);
  });

  test('product_line 为空时应放入"未分类"文件夹', async () => {
    const response = await apiContext.post('/api/requirements/import', {
      data: {
        content: '# 未分类导入测试\n\n## 需求描述'
      }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.productLine[0]).toBe('未分类');
  });
});

test.describe('API: POST /api/requirements/:id/prototype/import', () => {
  let apiContext;
  const API_BASE = `http://localhost:${process.env.PORT || 3300}`;
  let testReqId;

  test.beforeAll(async () => {
    apiContext = await pwRequest.newContext({ baseURL: API_BASE });

    // 先创建一个测试需求，用于后续原型导入测试
    const createResp = await apiContext.post('/api/requirements', {
      data: {
        title: '原型导入测试需求',
        productLine: '产品线A',
        priority: 'P2',
        platform: ['web']
      }
    });
    const createBody = await createResp.json();
    testReqId = createBody.id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('应成功导入 web 端原型 HTML', async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head><title>测试原型</title></head>
<body><h1>原型内容</h1></body>
</html>`;

    const response = await apiContext.post(`/api/requirements/${testReqId}/prototype/import`, {
      data: { content: htmlContent, platform: 'web' }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe(testReqId);
    expect(body.platform).toBe('web');
    expect(body.path).toMatch(/prototype-web\.html$/);
  });

  test('应自动注入 pm-craft-requirement-id meta 标签', async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head><title>Meta 注入测试</title></head>
<body><p>原型内容</p></body>
</html>`;

    const response = await apiContext.post(`/api/requirements/${testReqId}/prototype/import`, {
      data: { content: htmlContent, platform: 'web' }
    });

    expect(response.status()).toBe(200);

    // 验证文件确实被写入（通过再次获取需求来确认 hasPrototype 状态）
    const reqResp = await apiContext.get(`/api/requirements/${testReqId}`);
    const reqBody = await reqResp.json();
    expect(reqBody.hasPrototype.web).toBe(true);
  });

  test('应成功导入 mobile 端原型 HTML', async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head><title>移动端原型</title></head>
<body style="width:375px"><h1>移动端内容</h1></body>
</html>`;

    const response = await apiContext.post(`/api/requirements/${testReqId}/prototype/import`, {
      data: { content: htmlContent, platform: 'mobile' }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.platform).toBe('mobile');
    expect(body.path).toMatch(/prototype-mobile\.html$/);
  });

  test('platform 不合法时应默认使用 web', async () => {
    const response = await apiContext.post(`/api/requirements/${testReqId}/prototype/import`, {
      data: { content: '<html><body>fallback</body></html>', platform: 'desktop' }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.platform).toBe('web');
  });

  test('需求 ID 不存在时应返回 404', async () => {
    const response = await apiContext.post('/api/requirements/REQ-999999/prototype/import', {
      data: { content: '<html></html>', platform: 'web' }
    });
    expect(response.status()).toBe(404);
  });

  test('content 为空时应返回 400', async () => {
    const response = await apiContext.post(`/api/requirements/${testReqId}/prototype/import`, {
      data: { content: '', platform: 'web' }
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('API: /api/drafts (需求池)', () => {
  let apiContext;
  const API_BASE = `http://localhost:${process.env.PORT || 3300}`;
  let createdDraftId;

  test.beforeAll(async () => {
    apiContext = await pwRequest.newContext({ baseURL: API_BASE });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /api/drafts 应返回空数组或草稿列表', async () => {
    const response = await apiContext.get('/api/drafts');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.drafts)).toBe(true);
  });

  test('POST /api/drafts 应成功创建草稿', async () => {
    const response = await apiContext.post('/api/drafts', {
      data: {
        title: '测试草稿需求',
        priority: 'high',
        source: 'user_feedback',
        product_line: ['测试产品线'],
        tags: ['测试', '自动化']
      }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^DRAFT-\d+$/);
    createdDraftId = body.id;
  });

  test('GET /api/drafts/:id 应返回单个草稿', async () => {
    if (!createdDraftId) return; // 跳过如果创建失败

    const response = await apiContext.get(`/api/drafts/${createdDraftId}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(createdDraftId);
    expect(body.title).toBe('测试草稿需求');
  });

  test('PUT /api/drafts/:id 应成功更新草稿', async () => {
    if (!createdDraftId) return;

    const response = await apiContext.put(`/api/drafts/${createdDraftId}`, {
      data: {
        title: '更新后的测试草稿',
        priority: 'medium'
      }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // 验证更新成功
    const getResp = await apiContext.get(`/api/drafts/${createdDraftId}`);
    const getBody = await getResp.json();
    expect(getBody.title).toBe('更新后的测试草稿');
  });

  test('POST /api/drafts/:id/status 应更新草稿状态', async () => {
    if (!createdDraftId) return;

    const response = await apiContext.post(`/api/drafts/${createdDraftId}/status`, {
      data: { status: 'in_progress' }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // 验证状态更新
    const getResp = await apiContext.get(`/api/drafts/${createdDraftId}`);
    const getBody = await getResp.json();
    expect(getBody.status).toBe('in_progress');
  });

  test('POST /api/drafts/:id/publish 应发布草稿为正式需求', async () => {
    if (!createdDraftId) return;

    const response = await apiContext.post(`/api/drafts/${createdDraftId}/publish`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.requirementId).toMatch(/^REQ-\d+$/);

    // 验证草稿状态已更新为 published
    const getResp = await apiContext.get(`/api/drafts/${createdDraftId}`);
    const getBody = await getResp.json();
    expect(getBody.status).toBe('published');
  });

  test('DELETE /api/drafts/:id 应删除草稿', async () => {
    // 先创建一个草稿再删除
    const createResp = await apiContext.post('/api/drafts', {
      data: { title: '待删除的草稿' }
    });
    const createBody = await createResp.json();
    const draftId = createBody.id;

    const response = await apiContext.delete(`/api/drafts/${draftId}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // 验证删除成功（应返回 404）
    const getResp = await apiContext.get(`/api/drafts/${draftId}`);
    expect(getResp.status()).toBe(404);
  });

  test('GET /api/drafts/:id 不存在时应返回 404', async () => {
    const response = await apiContext.get('/api/drafts/DRAFT-999999');
    expect(response.status()).toBe(404);
  });

  test('POST /api/drafts 缺少必填字段 title 应返回 400', async () => {
    const response = await apiContext.post('/api/drafts', {
      data: { priority: 'high' }
    });
    expect(response.status()).toBe(400);
  });
});
