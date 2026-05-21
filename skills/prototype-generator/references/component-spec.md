# 组件代码参考
# prototype-generator references — 各组件的标准 Tailwind 代码
# AI 生成原型时直接引用，确保一致性

## 按钮组

### 主按钮（Primary）
✅ DO:
```html
<button class="bg-terracotta text-white rounded-full px-5 py-2.5 text-sm font-medium
               hover:bg-terracotta-light active:bg-terracotta-dark
               disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
  保存
</button>
```
❌ DON'T: `bg-blue-500` / `bg-indigo-600` / 硬编码色值
❌ DON'T: `rounded-lg`（统一用 rounded-full 胶囊）
❌ DON'T: 缺少 hover/active/disabled 状态

### 次要按钮（Secondary）
```html
<button class="bg-white border border-ink-200 text-ink-700 rounded-full px-5 py-2.5 text-sm font-medium
               hover:border-terracotta hover:text-terracotta
               active:bg-ink-50 transition-colors">
  取消
</button>
```

### 危险按钮（Destructive）
```html
<button class="bg-red-500 text-white rounded-full px-5 py-2.5 text-sm font-medium
               hover:bg-red-600 active:bg-red-700 transition-colors">
  删除
</button>
```

### 图标按钮（Icon Only）
```html
<button class="p-2 rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-100
               transition-colors" aria-label="设置">
  <svg class="w-5 h-5">...</svg>
</button>
```

## 输入框组

### 标准输入框
✅ DO:
```html
<div>
  <label class="block text-sm font-medium text-ink-700 mb-1.5">手机号</label>
  <input type="tel" placeholder="请输入11位手机号"
    class="w-full bg-ink-50 border border-ink-200 rounded-xl px-4 py-2.5 text-sm text-ink-700
           placeholder:text-ink-400
           focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none
           transition-all">
</div>
```
❌ DON'T: 用 `placeholder` 代替 `<label>`
❌ DON'T: `rounded-lg`（统一用 rounded-xl）
❌ DON'T: `bg-white`（输入框背景统一 bg-ink-50）

### 搜索框
```html
<div class="relative">
  <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400">...</svg>
  <input type="search" placeholder="搜索..."
    class="w-full bg-ink-50 border border-ink-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink-700
           placeholder:text-ink-400
           focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none
           transition-all">
</div>
```

### 下拉选择框
```html
<div>
  <label class="block text-sm font-medium text-ink-700 mb-1.5">状态</label>
  <select class="w-full bg-ink-50 border border-ink-200 rounded-xl px-4 py-2.5 text-sm text-ink-700
                 focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none
                 transition-all appearance-none cursor-pointer">
    <option>全部</option>
    <option>进行中</option>
  </select>
</div>
```

## 数据展示组

### 表格
```html
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-ink-200 bg-ink-50">
        <th class="px-5 py-3 text-left text-xs uppercase text-ink-400 font-medium">编号</th>
        <th class="px-5 py-3 text-left text-xs uppercase text-ink-400 font-medium">名称</th>
        <th class="px-5 py-3 text-left text-xs uppercase text-ink-400 font-medium">状态</th>
        <th class="px-5 py-3 text-right text-xs uppercase text-ink-400 font-medium">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-ink-100 hover:bg-ink-50 transition-colors">
        <td class="px-5 py-4 text-ink-700">ORD-001</td>
        <td class="px-5 py-4 text-ink-700">测试订单</td>
        <td class="px-5 py-4"><!-- Status Badge --></td>
        <td class="px-5 py-4 text-right"><!-- Actions --></td>
      </tr>
    </tbody>
  </table>
</div>
```

### 卡片
```html
<div class="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow">
  <h3 class="text-base font-semibold text-ink-700 mb-2">卡片标题</h3>
  <p class="text-sm text-ink-500">卡片描述文字</p>
</div>
```
❌ DON'T: 嵌套卡片（卡片内再放卡片）
❌ DON'T: 所有内容都包卡片——间距和对齐本身就能分组

### 状态 Badge
```html
<!-- 进行中 -->
<span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700">
  <span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>进行中
</span>
<!-- 已完成 -->
<span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700">
  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>已完成
</span>
<!-- 待处理 -->
<span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-ink-50 text-ink-500">
  <span class="w-1.5 h-1.5 rounded-full bg-ink-400 mr-1.5"></span>待处理
</span>
<!-- 错误 -->
<span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-red-50 text-red-700">
  <span class="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5"></span>失败
</span>
```

## 导航组

### 顶部导航
```html
<nav class="bg-white border-b border-ink-200 px-6 py-3 flex items-center gap-4">
  <span class="font-semibold text-ink-900">需求管理</span>
  <div class="flex gap-1">
    <button data-nav="page-list"
      class="px-3 py-1.5 rounded-full text-sm transition-colors bg-terracotta text-white">
      列表
    </button>
    <button data-nav="page-form"
      class="px-3 py-1.5 rounded-full text-sm transition-colors text-ink-500 hover:text-ink-700 hover:bg-ink-100">
      新建
    </button>
  </div>
</nav>
```

### 底部 Tab（移动端）
```html
<nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-ink-200 flex justify-around py-2">
  <button class="flex flex-col items-center gap-0.5 text-terracotta">
    <svg class="w-5 h-5">...</svg>
    <span class="text-xs">首页</span>
  </button>
  <button class="flex flex-col items-center gap-0.5 text-ink-400">
    <svg class="w-5 h-5">...</svg>
    <span class="text-xs">我的</span>
  </button>
</nav>
```

## 反馈组

### Toast
```html
<div id="toast-container" class="fixed top-5 right-5 z-50 flex flex-col gap-2"></div>

<script>
function showToast(msg, type = 'success') {
  const colors = {
    success: 'bg-emerald-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-ink-700 text-white'
  };
  const toast = document.createElement('div');
  toast.className = `px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${colors[type]}`;
  toast.textContent = msg;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}
</script>
```

### Modal
```html
<div id="modal-overlay" class="fixed inset-0 bg-ink-900/50 z-40 hidden flex items-center justify-center">
  <div class="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
    <h3 class="text-lg font-semibold text-ink-700 mb-2">确认删除</h3>
    <p class="text-sm text-ink-500 mb-6">删除后不可恢复，确认继续？</p>
    <div class="flex gap-3 justify-end">
      <button onclick="closeModal()" class="bg-white border border-ink-200 text-ink-700 rounded-full px-5 py-2.5 text-sm">取消</button>
      <button onclick="confirmDelete()" class="bg-red-500 text-white rounded-full px-5 py-2.5 text-sm">删除</button>
    </div>
  </div>
</div>
```
❌ DON'T: 用 `alert()` / `confirm()` / `prompt()`
✅ DO: 用自定义 Modal 或 Toast

## 页面状态

### 空状态
```html
<div class="flex flex-col items-center justify-center py-16 text-center">
  <svg class="w-16 h-16 text-ink-200 mb-4">...</svg>
  <h3 class="text-lg font-medium text-ink-700 mb-2">暂无数据</h3>
  <p class="text-sm text-ink-400 mb-6">创建第一条记录开始使用</p>
  <button class="bg-terracotta text-white rounded-full px-5 py-2.5 text-sm">新建</button>
</div>
```
✅ DO: 空状态教用户怎么开始，不只是"暂无数据"
❌ DON'T: 纯文字空状态

### 加载态（骨架屏）
```html
<div class="animate-pulse space-y-4">
  <div class="h-4 bg-ink-100 rounded w-1/3"></div>
  <div class="h-10 bg-ink-100 rounded-xl"></div>
  <div class="h-10 bg-ink-100 rounded-xl"></div>
</div>
```
✅ DO: 骨架屏 > 纯 spinner（预览内容形状，体感更快）
