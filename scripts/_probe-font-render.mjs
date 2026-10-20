/**
 * 探针：`page.setContent` 能否加载 **HTTP 字体 URL**，以及 `fontChecks` 是否真的拦截 fallback。
 *
 * 为什么必须实测：出图页面是 about:blank，字体是跨源请求；CORS/加载时序任何一处
 * 不对，浏览器都会静默 fallback，PNG 看起来"正常"但字体是错的。
 *
 * 跑法：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-font-render.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBlinkRenderer } from '../src/render/rasterize/blink-renderer.ts';

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

const fontPath = resolve('designassets/fonts/families/NotoSerifSC/400.woff2');
const font = readFileSync(fontPath);

const server = createServer((req, res) => {
  if (req.url === '/font.woff2') {
    res.writeHead(200, {
      'Content-Type': 'font/woff2',
      'Content-Length': font.length,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(font);
    return;
  }
  res.writeHead(404).end('no');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log('font server on', port);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Noto Serif SC";font-style:normal;font-weight:400;font-display:block;
src:url("http://127.0.0.1:${port}/font.woff2") format("woff2")}
html,body{margin:0;background:#fff}
.t{font-family:"Noto Serif SC",serif;font-size:80px;line-height:1.2}
</style></head><body><div class="t">野豆</div></body></html>`;

const outDir = mkdtempSync(join(tmpdir(), 'vinart-font-probe-'));
const renderer = await createBlinkRenderer();
try {
  const out = await renderer.render(
    { html },
    outDir,
    {
      width: 400,
      height: 200,
      deviceScaleFactor: 1,
      format: 'png',
      filename: 'font-ok',
      fontChecks: [{ family: 'Noto Serif SC', weight: 400 }],
    },
  );
  ok(out.size > 0, `带字体 URL 出图成功（${out.size} bytes）`);

  let failed = false;
  try {
    await renderer.render(
      { html },
      outDir,
      {
        width: 400,
        height: 200,
        deviceScaleFactor: 1,
        format: 'png',
        filename: 'font-missing',
        fontChecks: [{ family: 'No Such Font', weight: 400 }],
      },
    );
  } catch (e) {
    failed = /字体未加载/.test(String(e));
  }
  ok(failed, '缺字体时 fontChecks 会拒绝出图');
} finally {
  await renderer.dispose();
  server.close();
}

console.log('\n全部通过');
