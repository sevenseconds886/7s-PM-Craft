/**
 * PM-Craft 启动器
 *
 * 功能：双击 .bat 后自动启动 PM-Craft 服务 + 打开浏览器，
 *       端口被占用时通过 GUI 弹框（VBS InputBox）让用户切换端口。
 *
 * 零额外依赖：仅使用 Node.js 内置模块 + Windows 原生 cscript/pm2。
 * 不修改 server.js，启动器仅作为外壳。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const os = require('os');
const { execSync, exec } = require('child_process');

// ============================================================================
// 常量定义
// ============================================================================

/** 配置文件路径（与 launcher.js 同目录，用 __dirname 拼接） */
const CONFIG_PATH = path.join(__dirname, '.launcher.json');

/** 默认配置 */
const DEFAULT_CONFIG = {
  port: 3456,
  processName: 'pm-craft-dev'
};

/** 健康检查路径 */
const HEALTH_CHECK_PATH = '/api/requirements';

/** 健康检查轮询间隔（毫秒） */
const HEALTH_CHECK_INTERVAL = 500;

/** 健康检查总超时时间（毫秒） */
const HEALTH_CHECK_TIMEOUT = 15000;

/** 单次 HTTP 请求超时（毫秒） */
const HTTP_REQUEST_TIMEOUT = 3000;

/** 推荐备用端口列表 */
const RECOMMENDED_PORTS = [3300, 8080, 8081];

/** 端口合法范围 */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 带统一前缀的日志输出，方便用户排查问题。
 * @param {string} msg - 日志消息
 */
function log(msg) {
  console.log(`[PM-Craft 启动器] ${msg}`);
}

/**
 * 读取启动器配置文件。
 * - 首次运行（文件不存在）时创建默认配置。
 * - 文件损坏时回退到默认配置并重建文件。
 * @returns {{port: number, processName: string}} 配置对象
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        port: Number(parsed.port) || DEFAULT_CONFIG.port,
        processName: parsed.processName || DEFAULT_CONFIG.processName
      };
    }
  } catch (err) {
    log(`配置文件读取失败，使用默认配置：${err.message}`);
  }
  // 首次运行或配置损坏 —— 创建默认配置
  saveConfig(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}

/**
 * 保存启动器配置到文件（JSON 格式，2 空格缩进）。
 * @param {{port: number, processName: string}} config - 配置对象
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    log(`配置文件保存失败：${err.message}`);
  }
}

/**
 * 检测指定端口是否可用（未被占用）。
 * 通过 net.createServer().listen(port) 尝试占用：
 *   - listen 成功 → 端口可用
 *   - EADDRINUSE  → 端口被占用
 * 监听后立即关闭 server，释放端口供后续 pm2 使用。
 * @param {number} port - 待检测端口
 * @returns {Promise<boolean>} true=可用，false=被占用
 */
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;

    const done = (result) => {
      if (!resolved) {
        resolved = true;
        try { server.close(); } catch (e) { /* server 未监听时 close 可能抛异常，忽略 */ }
        resolve(result);
      }
    };

    server.once('error', () => done(false));
    server.once('listening', () => done(true));
    server.listen(port);
  });
}

/**
 * 查询占用指定端口的进程列表。
 * 流程：netstat -ano 提取 PID → tasklist 查进程名。
 * @param {number} port - 端口号
 * @returns {{name: string, pid: string}[]} 占用进程列表（可能为空）
 */
function getPortOccupants(port) {
  const occupants = [];
  try {
    const netstatOutput = execSync(`netstat -ano | findstr :${port}`, {
      windowsHide: true,
      encoding: 'utf8'
    });

    // 提取所有匹配端口的 PID（去重）
    const pids = new Set();
    for (const line of netstatOutput.trim().split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      // netstat -ano 格式：Proto  LocalAddress  ForeignAddress  State  PID
      // 例：TCP  0.0.0.0:3456  0.0.0.0:0  LISTENING  12345
      if (parts.length >= 4) {
        const localAddr = parts[1] || '';
        if (localAddr.endsWith(`:${port}`)) {
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            pids.add(pid);
          }
        }
      }
    }

    // 逐个 PID 查询进程名
    for (const pid of pids) {
      try {
        const taskOutput = execSync(
          `tasklist /FI "PID eq ${pid}" /NH /FO CSV`,
          { windowsHide: true, encoding: 'utf8' }
        );
        // tasklist CSV 格式："ImageName","PID","SessionName","Session#","MemUsage"
        const match = taskOutput.match(/"([^"]+)","(\d+)"/);
        if (match) {
          occupants.push({ name: match[1], pid: match[2] });
        }
      } catch (e) {
        // PID 可能已退出，跳过
      }
    }
  } catch (e) {
    // netstat 无匹配输出（端口实际未占用）或命令执行失败
  }
  return occupants;
}

/**
 * 将任意字符串转换为 VBS 安全表达式。
 *
 * 关键设计：非 ASCII 字符（如中文）用 ChrW(码点) 表示，
 * 确保生成的 VBS 文件为纯 ASCII。这样无论 cscript 以何种
 * 编码读取文件，中文都能通过 ChrW 在运行时正确生成，
 * 彻底规避「UTF-8 文件被中文 Windows 以 GBK 解读」的乱码问题。
 *
 * @param {string} str - 原始字符串（可含中文、特殊字符）
 * @returns {string} VBS 表达式，如 '"abc" & ChrW(20013) & ChrW(25991)'
 */
function toVbsString(str) {
  if (!str) return '""';

  let result = '';
  let asciiBuf = '';

  /** 将累积的 ASCII 字符输出为 VBS 字符串字面量 */
  const flushAscii = () => {
    if (asciiBuf) {
      // VBS 字符串中双引号需转义为 ""
      result += '"' + asciiBuf.replace(/"/g, '""') + '" & ';
      asciiBuf = '';
    }
  };

  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code < 128) {
      asciiBuf += ch;
    } else {
      flushAscii();
      result += `ChrW(${code}) & `;
    }
  }
  flushAscii();

  // 去掉末尾多余的 ' & '
  if (result.endsWith(' & ')) {
    result = result.slice(0, -3);
  }
  return result || '""';
}

/**
 * 通过 VBS InputBox 弹出 GUI 输入框，让用户输入新端口号。
 *
 * - 用户点击「确定」→ 返回输入字符串
 * - 用户点击「取消」→ 返回空字符串（调用方据此退出）
 *
 * @param {number} occupiedPort - 当前被占用的端口号
 * @param {{name: string, pid: string}[]} occupants - 占用进程列表
 * @param {string} [errorMessage=''] - 上次输入的错误提示（可选，非空时显示在弹框顶部）
 * @returns {string} 用户输入的字符串（取消则返回空字符串）
 */
function promptForPort(occupiedPort, occupants, errorMessage) {
  const lines = [];

  if (errorMessage) {
    lines.push(`[输入无效] ${errorMessage}`);
    lines.push('');
  }

  lines.push(`端口 ${occupiedPort} 已被占用：`);
  if (occupants.length > 0) {
    for (const occ of occupants) {
      lines.push(`  - 进程 ${occ.name} (PID ${occ.pid})`);
    }
  } else {
    lines.push('  - （未检测到具体进程，可能被系统保留）');
  }
  lines.push('');
  lines.push(`请输入新的端口号（建议 ${RECOMMENDED_PORTS.join(' / ')}）：`);

  const promptText = lines.join('\r\n');
  const title = 'PM-Craft 端口配置';
  const defaultVal = String(RECOMMENDED_PORTS[0]);

  // 构建 VBS 脚本（纯 ASCII，中文通过 ChrW 表达，避免编码问题）
  const vbsScript = [
    'Dim result',
    `result = InputBox(${toVbsString(promptText)}, ${toVbsString(title)}, ${toVbsString(defaultVal)})`,
    'If IsEmpty(result) Then',
    '  WScript.StdOut.Write ""',
    'Else',
    '  WScript.StdOut.Write CStr(result)',
    'End If'
  ].join('\r\n');

  // 写入临时 VBS 文件
  const tempFile = path.join(
    os.tmpdir(),
    `pmcraft_prompt_${Date.now()}_${process.pid}.vbs`
  );

  try {
    fs.writeFileSync(tempFile, vbsScript, 'utf8');
    const output = execSync(`cscript //nologo "${tempFile}"`, {
      windowsHide: true,
      encoding: 'utf8'
    });
    return output.trim();
  } catch (e) {
    log(`GUI 弹框执行失败：${e.message}`);
    return '';
  } finally {
    // 临时文件用完即删
    try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
  }
}

/**
 * 通过 VBS MsgBox 弹出错误提示框（带红色错误图标）。
 * VBS 不可用时回退到控制台输出。
 * @param {string} message - 错误消息
 */
function showError(message) {
  const title = 'PM-Craft 启动器';
  const vbsScript = [
    'Dim msg',
    `msg = ${toVbsString(message)}`,
    `MsgBox msg, vbCritical, ${toVbsString(title)}`
  ].join('\r\n');

  const tempFile = path.join(
    os.tmpdir(),
    `pmcraft_error_${Date.now()}_${process.pid}.vbs`
  );

  try {
    fs.writeFileSync(tempFile, vbsScript, 'utf8');
    execSync(`cscript //nologo "${tempFile}"`, {
      windowsHide: true,
      encoding: 'utf8'
    });
  } catch (e) {
    // VBS 不可用时回退到控制台
    console.error(`[PM-Craft 启动器] 错误：${message}`);
  } finally {
    try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
  }
}

/**
 * 检查 pm2 中是否已存在指定名称的进程。
 * 通过 pm2 jlist 获取 JSON 格式的进程列表并匹配名称。
 * @param {string} processName - pm2 进程名
 * @returns {boolean} true=已存在
 */
function pm2ProcessExists(processName) {
  try {
    const output = execSync('pm2 jlist', {
      windowsHide: true,
      encoding: 'utf8',
      cwd: __dirname
    });
    const list = JSON.parse(output);
    return Array.isArray(list) && list.some(p => p.name === processName);
  } catch (e) {
    // pm2 未安装或守护进程未启动 → 视为进程不存在
    return false;
  }
}

/**
 * 通过 pm2 启动（或重启）PM-Craft 服务。
 *
 * - 进程已存在 → pm2 restart --update-env（更新端口环境变量）
 * - 进程不存在 → pm2 start server.js --name <processName>
 *
 * 注意：server.js 通过 process.env.PORT 读取端口（见 server.js 第 20 行：
 *   const PORT = process.env.PORT || 3456;），
 * 因此通过 execSync 的 env 选项设置 PORT 环境变量使端口生效。
 * 同时传递 -- --port 参数以兼容未来可能读取 argv 的版本。
 *
 * @param {number} port - 服务端口
 * @param {string} processName - pm2 进程名
 */
function startService(port, processName) {
  const env = { ...process.env, PORT: String(port) };

  if (pm2ProcessExists(processName)) {
    log(`检测到进程 ${processName} 已存在，执行重启...`);
    execSync(`pm2 restart "${processName}" --update-env`, {
      windowsHide: true,
      cwd: __dirname,
      env
    });
  } else {
    execSync(`pm2 start server.js --name "${processName}" -- --port ${port}`, {
      windowsHide: true,
      cwd: __dirname,
      env
    });
  }
}

/**
 * 健康检查：轮询 http://localhost:PORT/api/requirements，
 * 每 500ms 一次，收到 HTTP 200 则通过，超时 15 秒则失败。
 * 超时后仍由调用方打开浏览器（输出警告）。
 * @param {number} port - 服务端口
 * @returns {Promise<boolean>} true=健康检查通过，false=超时
 */
function healthCheck(port) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let settled = false;

    /** 安全 resolve，防止重复调用 */
    const safeResolve = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    const check = () => {
      // 超时检查
      if (Date.now() - startTime > HEALTH_CHECK_TIMEOUT) {
        safeResolve(false);
        return;
      }

      const req = http.get(
        `http://localhost:${port}${HEALTH_CHECK_PATH}`,
        (res) => {
          res.resume(); // 消费响应体，释放内存
          if (res.statusCode === 200) {
            safeResolve(true);
          } else {
            setTimeout(check, HEALTH_CHECK_INTERVAL);
          }
        }
      );

      req.on('error', () => {
        setTimeout(check, HEALTH_CHECK_INTERVAL);
      });

      req.setTimeout(HTTP_REQUEST_TIMEOUT, () => {
        req.destroy();
        setTimeout(check, HEALTH_CHECK_INTERVAL);
      });
    };

    check();
  });
}

/**
 * 打开默认浏览器访问 PM-Craft 首页。
 * 使用 Windows start 命令（非阻塞，不等待浏览器关闭）。
 * @param {number} port - 服务端口
 */
function openBrowser(port) {
  exec(`start "" "http://localhost:${port}"`, {
    windowsHide: true,
    cwd: __dirname
  });
}

// ============================================================================
// 主流程
// ============================================================================

/**
 * 启动器主流程：
 *   1. 读取配置
 *   2. 检测端口（被占用则弹框让用户输入新端口）
 *   3. 保存配置
 *   4. pm2 启动服务
 *   5. 健康检查
 *   6. 打开浏览器
 *   7. 退出
 */
async function main() {
  // --- 步骤 1：读取配置 ---
  log('读取配置...');
  const config = loadConfig();
  let port = config.port;
  const processName = config.processName;
  let errorMessage = '';

  // --- 步骤 2 & 3：端口检测与选择（循环直到找到可用端口或用户取消） ---
  while (true) {
    log(`检测端口 ${port}...`);
    const available = await checkPort(port);

    if (available) {
      log(`端口 ${port} 可用`);
      break;
    }

    // 端口被占用 → GUI 弹框让用户输入新端口
    log(`端口 ${port} 已被占用`);
    const occupants = getPortOccupants(port);
    const input = promptForPort(port, occupants, errorMessage);
    errorMessage = ''; // 消费后重置

    if (!input || input.trim() === '') {
      // 用户点击取消
      log('用户取消，启动器退出');
      process.exit(0);
    }

    const trimmed = input.trim();
    const newPort = parseInt(trimmed, 10);

    // 输入校验：必须是 1024-65535 的整数
    if (
      isNaN(newPort) ||
      newPort < MIN_PORT ||
      newPort > MAX_PORT ||
      String(newPort) !== trimmed
    ) {
      errorMessage = `"${trimmed}" 不是合法端口号，请输入 ${MIN_PORT}-${MAX_PORT} 之间的整数`;
      // 不更新 port，下一轮重新检测当前端口并带错误提示弹框
      continue;
    }

    // 合法端口号，更新 port 并重新检测
    port = newPort;
  }

  // --- 步骤 3：保存配置 ---
  saveConfig({ port, processName });

  // --- 步骤 4：pm2 启动服务 ---
  log(`通过 pm2 启动服务（进程名：${processName}）...`);
  try {
    startService(port, processName);
  } catch (err) {
    const msg =
      `pm2 启动失败：${err.message}\n` +
      '请确认 pm2 已全局安装（npm install -g pm2）且 server.js 存在。';
    log(msg);
    showError(msg);
    process.exit(1);
  }

  // --- 步骤 5：健康检查 ---
  log('健康检查中...');
  const healthy = await healthCheck(port);
  if (healthy) {
    log(`服务已就绪，打开浏览器 http://localhost:${port}`);
  } else {
    log(`警告：服务启动可能较慢，请稍后访问 http://localhost:${port}`);
  }

  // --- 步骤 6：打开浏览器 ---
  openBrowser(port);

  // --- 步骤 7：退出（延迟 2 秒让用户看到结果） ---
  log('启动完成，本窗口可关闭');
  setTimeout(() => process.exit(0), 2000);
}

// ============================================================================
// 全局错误处理（防止未捕获异常导致窗口闪退）
// ============================================================================

process.on('uncaughtException', (err) => {
  const msg = `启动器发生未捕获异常：${err.message}`;
  try {
    log(msg);
    showError(msg);
  } catch (e) {
    console.error('[PM-Craft 启动器]', msg);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = `启动器发生未处理的 Promise 拒绝：${reason}`;
  try {
    log(msg);
    showError(msg);
  } catch (e) {
    console.error('[PM-Craft 启动器]', msg);
  }
  process.exit(1);
});

// 启动主流程
main();
