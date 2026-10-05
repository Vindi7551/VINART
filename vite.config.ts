import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

// vite.config 以 ESM 加载（package.json type: module），没有 __dirname
const ROOT = fileURLToPath(new URL('.', import.meta.url));

const API_PORT = 8787;

/** 浏览器要"看得见"的工作区目录 → URL 前缀映射 */
const FILE_ROOTS: [prefix: string, dir: string][] = [
  ['/files/test_product/', 'test_product'],
  ['/files/designassets/', 'designassets'],
];

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * 让浏览器「看得见」工作区文件：/files/<工作区路径> → 静态文件（白名单内）。
 * API 接口（/api/*）已全部归拢到 scripts/dev-server.ts，这里只管静态文件。
 */
function workspaceFiles(): Plugin {
  return {
    name: 'serve-workspace-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];

        for (const [prefix, dir] of FILE_ROOTS) {
          if (!url.startsWith(prefix)) continue;
          const base = resolve(ROOT, dir);
          // decodeURIComponent：文件名可能含空格/中文
          const abs = resolve(base, decodeURIComponent(url.slice(prefix.length)));
          // 防目录穿越：解析结果必须仍在白名单根内
          if (abs !== base && !abs.startsWith(base + sep)) {
            res.statusCode = 403;
            return res.end('forbidden');
          }
          if (!existsSync(abs) || !statSync(abs).isFile()) {
            res.statusCode = 404;
            return res.end(`not found: ${url}`);
          }
          res.setHeader('Content-Type', MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream');
          return createReadStream(abs).pipe(res);
        }

        next();
      });
    },
  };
}

/** 探测 API 服务是否已经在跑（手动起的 / 上一次没退干净的） */
async function apiUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 600);
    const r = await fetch(`http://localhost:${API_PORT}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * API 服务托管 + 自愈:
 * - 启动时拉起;之后任何 /api 请求前都先确认 8787 活着——
 *   死了(被误杀/崩溃/启动竞态漏拉)就现场重拉并等就绪,再放行给代理。
 *   实测教训:API 服务死掉后 vite 代理返回 502 空响应体,前端只会看到
 *   空白错误信息,用户不知道要重启 dev——自愈比追责靠谱。
 * - vite 配置热重启(同一进程)→ 先等旧子进程退净再拉新的,避免端口抢占竞态
 * - vite 进程退出 → 'exit' 钩子杀掉子进程,不在 Windows 上留孤儿
 */
function apiServer(): Plugin {
  let child: ChildProcess | null = null;
  let ensuring: Promise<boolean> | null = null;

  process.on('exit', () => child?.kill());

  const spawnApi = () => {
    child = spawn(process.execPath, ['scripts/run-ts.mjs', 'scripts/dev-server.ts'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout!.on('data', (d) => process.stdout.write(`[api] ${d}`));
    child.stderr!.on('data', (d) => process.stderr.write(`[api] ${d}`));
    child.on('exit', (code) => {
      console.log(`[vite] API server 退出 (code=${code})`);
      child = null;
    });
    console.log(`[vite] 已拉起 API server (:${API_PORT})`);
  };

  /** 确保 8787 活着;不在就拉起并等就绪(esbuild 打包+启动 ≈ 1-3s) */
  async function ensureApi(): Promise<boolean> {
    if (await apiUp()) return true;
    if (ensuring) return ensuring;
    ensuring = (async () => {
      try {
        if (child) {
          const old = child;
          child = null;
          old.kill();
          await new Promise((r) => old.once('exit', r));
        }
        spawnApi();
        for (let i = 0; i < 40; i++) {
          if (await apiUp()) return true;
          await new Promise((r) => setTimeout(r, 250));
        }
        return false;
      } finally {
        ensuring = null;
      }
    })();
    return ensuring;
  }

  return {
    name: 'api-server-keeper',
    async configureServer(server) {
      await ensureApi();
      // 挂在 /api 前缀上:connect 会先剥前缀、next() 时还原,下游代理照常工作
      server.middlewares.use('/api', (_req, _res, next) => {
        ensureApi()
          .catch(() => false)
          .then(() => next());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), workspaceFiles(), apiServer()],
  server: {
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
    watch: {
      // ⚠️ 产物/工作目录必须排除:vite 监视整个项目根做热更新,而
      // test_product 里会出现浏览器下载中的 .crdownload(Windows 上被锁)
      // 和管线正在写的 png/json——chokidar 碰到锁定文件会 EBUSY 且
      // 错误未被接住,直接把 dev server 进程干崩(实测 2026-10-04)。
      // 这些目录与前端模块图无关,监视它们零收益、纯风险。
      ignored: ['**/test_product/**', '**/designassets/**', '**/.tmp-run/**', '**/.workbuddy/**'],
    },
  },
  optimizeDeps: {
    exclude: ['playwright', 'playwright-core'],
  },
  build: {
    rollupOptions: {
      external: ['playwright', 'playwright-core'],
    },
  },
});
