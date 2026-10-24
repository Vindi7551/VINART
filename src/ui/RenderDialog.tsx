import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Hint, Select, SliderField, TextInput } from './primitives';
import { DirectoryBrowser } from './DirectoryBrowser';
import {
  sanitizeRenderFilename,
  type RenderFormat,
  type RenderJobOptions,
  type RenderJobResult,
} from '../render/options';

/**
 * **出图设置弹窗** —— 工具栏「出图」按钮的入口。
 *
 * ## 这一版的两个重点
 *
 * 1. **进度留在弹窗里，不进对话区**：出图是 2–6 秒的同步请求，没有可靠的
 *    百分比（服务端只有一次 `page.screenshot`），所以进度条是**无限循环**的，
 *    配合已用秒数；完成/失败后原地变成结果/错误，不往对话流里塞“⟳ 出图…”。
 * 2. **工作区永远保留 `final.png`**（画廊/预览/缩略图只认它）；这里选的是
 *    **导出副本**的位置、格式、倍率。PNG 同倍率时服务端直接 copy canonical，
 *    JPEG 才会多渲一次。
 *
 * 其它取舍：
 * - 倍率不是越高越好：文字会更清楚，但低分辨率素材会被放得更大、反而更糊。
 *   弹窗只给 1× / 2× / 3×，并把实际输出尺寸直接写出来。
 * - 保存路径用应用内目录浏览器（`/api/fs/list`）选，不依赖系统对话框。
 * - 上一次的倍率/格式/质量/文件名记在 localStorage；**路径不记**——换版式后
 *   旧路径可能已经不该用了，每次打开都从当前版式目录起步。
 */

const PREFS_KEY = 'vinart.renderPrefs';

type RenderStatus = 'idle' | 'running' | 'done' | 'error';

interface Prefs {
  deviceScaleFactor: number;
  format: RenderFormat;
  quality: number;
  filename: string;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { deviceScaleFactor: 2, format: 'png', quality: 95, filename: 'final' };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      deviceScaleFactor:
        raw.deviceScaleFactor === 1 || raw.deviceScaleFactor === 2 || raw.deviceScaleFactor === 3
          ? raw.deviceScaleFactor
          : fallback.deviceScaleFactor,
      format: raw.format === 'jpeg' ? 'jpeg' : 'png',
      quality:
        typeof raw.quality === 'number' && raw.quality >= 1 && raw.quality <= 100
          ? Math.round(raw.quality)
          : fallback.quality,
      filename: typeof raw.filename === 'string' && raw.filename.trim() ? raw.filename : fallback.filename,
    };
  } catch {
    return fallback;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式/配额 —— 记不住就算了 */
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface RenderDialogProps {
  open: boolean;
  layoutName: string;
  canvasWidth: number;
  canvasHeight: number;
  /** 版式目录（服务端 `/data` 下发的 `dir`）；空 = 由服务端兜底 */
  defaultDir?: string;
  onClose: () => void;
  /**
   * 真正发请求。由 App 负责 fetch / 刷新画廊 / 记录动作；
   * **不要在这里或 App 里往对话区写消息**（进度只在弹窗里）。
   */
  onRender: (opts: RenderJobOptions) => Promise<RenderJobResult>;
}

export function RenderDialog({
  open,
  layoutName,
  canvasWidth,
  canvasHeight,
  defaultDir,
  onClose,
  onRender,
}: RenderDialogProps) {
  const [deviceScaleFactor, setDeviceScaleFactor] = useState(2);
  const [format, setFormat] = useState<RenderFormat>('png');
  const [quality, setQuality] = useState(95);
  const [filename, setFilename] = useState('final');
  const [outputDir, setOutputDir] = useState(defaultDir ?? '');
  const [dirOpen, setDirOpen] = useState(false);

  const [status, setStatus] = useState<RenderStatus>('idle');
  const [result, setResult] = useState<RenderJobResult | null>(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  // 每次打开都回到当前版式目录；参数沿用上次，进度清零。
  useEffect(() => {
    if (!open) return;
    const p = loadPrefs();
    setDeviceScaleFactor(p.deviceScaleFactor);
    setFormat(p.format);
    setQuality(p.quality);
    setFilename(p.filename);
    setOutputDir(defaultDir ?? '');
    setDirOpen(false);
    setStatus('idle');
    setResult(null);
    setError('');
    setElapsed(0);
  }, [open, defaultDir]);

  // 只在 running 时走表；完成/失败后停在最后读数。
  useEffect(() => {
    if (status !== 'running') return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => window.clearInterval(id);
  }, [status]);

  const outW = Math.round(canvasWidth * deviceScaleFactor);
  const outH = Math.round(canvasHeight * deviceScaleFactor);
  const megapixels = (outW * outH) / 1_000_000;
  const large = megapixels > 30 || Math.max(outW, outH) > 10_000;
  const effectiveDir = outputDir.trim() || defaultDir || '';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const displayDir = effectiveDir.replace(/[\\/]+$/, '');
  const displaySep = displayDir.includes('\\') ? '\\' : '/';
  const displayName = sanitizeRenderFilename(filename);
  const displayPath = displayDir ? `${displayDir}${displaySep}${displayName}.${ext}` : '';
  const locked = status === 'running' || status === 'done';

  const close = () => {
    if (status === 'running') return;
    onClose();
  };

  const reset = () => {
    setStatus('idle');
    setResult(null);
    setError('');
    setElapsed(0);
  };

  const submit = async () => {
    if (status === 'running') return;
    const name = filename.trim() || 'final';
    savePrefs({ deviceScaleFactor, format, quality, filename: name });
    setStatus('running');
    setElapsed(0);
    setResult(null);
    setError('');
    try {
      const res = await onRender({
        deviceScaleFactor,
        format,
        quality,
        outputDir: outputDir.trim(),
        filename: name,
      });
      if (res.ok) {
        setStatus('done');
        setResult(res);
      } else {
        setStatus('error');
        setError(res.log ?? '未知错误');
      }
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="出图设置"
      subtitle={`${layoutName} · 画布 ${canvasWidth}×${canvasHeight}`}
      width={560}
      closable={status !== 'running'}
      footer={
        status === 'running' ? (
          <>
            <div style={{ flex: 1 }} />
            <Button variant="primary" disabled>
              渲染中…
            </Button>
          </>
        ) : status === 'done' ? (
          <>
            <Button variant="ghost" onClick={reset}>
              再出一次
            </Button>
            <div style={{ flex: 1 }} />
            <Button variant="primary" onClick={close}>
              完成
            </Button>
          </>
        ) : status === 'error' ? (
          <>
            <Button variant="ghost" onClick={close}>
              关闭
            </Button>
            <div style={{ flex: 1 }} />
            <Button variant="primary" onClick={() => void submit()}>
              重试
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              取消
            </Button>
            <div style={{ flex: 1 }} />
            <Button variant="primary" onClick={() => void submit()}>
              出图
            </Button>
          </>
        )
      }
    >
      <div className="render-form">
        {status !== 'idle' ? (
          <div className="render-progress">
            <div className="render-progress-head" aria-live="polite">
              <span>
                {status === 'running'
                  ? '正在出图…'
                  : status === 'done'
                    ? '✓ 出图完成'
                    : '✗ 出图失败'}
              </span>
              <span>
                {status === 'running'
                  ? `${elapsed.toFixed(1)}s`
                  : status === 'done' && result?.width && result.height
                    ? `${result.width}×${result.height}`
                    : ''}
              </span>
            </div>
            <div
              className="render-progress-track"
              role="progressbar"
              aria-label="出图进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status === 'done' ? 100 : undefined}
            >
              <div className={`render-progress-bar ${status}`} />
            </div>
            {status === 'running' ? (
              <Hint>首次出图可能要等浏览器启动；完成前请保持此窗口打开。</Hint>
            ) : null}
            {status === 'done' && result ? (
              <div className="render-result">
                {result.png ? (
                  <div>
                    <span>工作区</span>
                    <code>{result.png}</code>
                  </div>
                ) : null}
                {result.savedTo && result.savedTo !== result.png ? (
                  <div>
                    <span>导出</span>
                    <code>{result.savedTo}</code>
                  </div>
                ) : null}
                {result.size ? (
                  <div>
                    <span>大小</span>
                    <code>{formatBytes(result.size)}</code>
                  </div>
                ) : null}
              </div>
            ) : null}
            {status === 'error' ? <div className="render-error">{error || '未知错误'}</div> : null}
          </div>
        ) : null}

        <fieldset className="render-fields" disabled={locked}>
          <div className="ui-fields">
            <Field label="输出倍率" hint={`实际输出 ${outW}×${outH}`}>
              <Select
                value={deviceScaleFactor}
                onChange={(e) => setDeviceScaleFactor(Number(e.target.value))}
              >
                <option value={1}>1×（{Math.round(canvasWidth)}×{Math.round(canvasHeight)}）</option>
                <option value={2}>2×（{Math.round(canvasWidth * 2)}×{Math.round(canvasHeight * 2)}）</option>
                <option value={3}>3×（{Math.round(canvasWidth * 3)}×{Math.round(canvasHeight * 3)}）</option>
              </Select>
            </Field>
            <Field label="导出格式" hint="工作区始终保留 final.png">
              <Select value={format} onChange={(e) => setFormat(e.target.value as RenderFormat)}>
                <option value="png">PNG（无损）</option>
                <option value="jpeg">JPEG（有损，体积小）</option>
              </Select>
            </Field>
            {format === 'jpeg' ? (
              <div className="wide">
                <SliderField
                  label="JPEG 质量"
                  value={quality}
                  min={1}
                  max={100}
                  display={`${quality}`}
                  onChange={setQuality}
                />
              </div>
            ) : null}
            <Field label="保存到" className="wide">
              <div className="render-path-row">
                <TextInput
                  value={outputDir}
                  placeholder={defaultDir ? `${defaultDir}（默认）` : '默认：当前版式目录'}
                  onChange={(e) => setOutputDir(e.target.value)}
                  spellCheck={false}
                />
                <Button onClick={() => setDirOpen(true)}>浏览…</Button>
                {defaultDir && outputDir.trim() !== defaultDir ? (
                  <Button variant="ghost" onClick={() => setOutputDir(defaultDir)}>
                    默认
                  </Button>
                ) : null}
              </div>
              <Hint>{displayPath ? `导出到：${displayPath}` : '默认导出到当前版式目录'}</Hint>
            </Field>
            <Field label="文件名" hint={`会自动补 .${ext}；空格/特殊字符会换成 _`}>
              <TextInput
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <div className="wide">
              <Hint>
                PNG 无损；JPEG 是有损的，且会比 PNG 多渲染一次。工作区始终保留 final.png 供画廊和预览。
              </Hint>
              {large ? (
                <Hint>
                  ⚠️ 输出约 {megapixels.toFixed(1)} MP（{outW}×{outH}），渲染会更慢、文件更大；素材分辨率不够时，提高倍率反而更糊。
                </Hint>
              ) : null}
            </div>
          </div>
        </fieldset>
      </div>

      {/* 目录浏览器是第二层 Dialog；包一层阻止点击冒泡到外层遮罩，否则点它会把出图弹窗一起关掉 */}
      <div onClick={(e) => e.stopPropagation()}>
        <DirectoryBrowser
          open={dirOpen}
          title="选择出图保存目录"
          initialDir={outputDir.trim() || defaultDir || ''}
          pickLabel="选择此目录"
          onPick={(p) => {
            setOutputDir(p);
            setDirOpen(false);
          }}
          onClose={() => setDirOpen(false)}
        />
      </div>
    </Dialog>
  );
}
