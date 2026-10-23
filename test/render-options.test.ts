import { describe, expect, it } from 'vitest';
import { sanitizeRenderFilename } from '../src/render/options';
import { normalizeRenderOptions } from '../src/server/render-options';

/**
 * 出图参数是**前端可传**的，服务端必须自己兜底：
 * 倍率越界、格式瞎写、filename 带路径、quality 非数字 —— 都不能原样落盘。
 */
describe('出图参数归一化', () => {
  it('空 body = 2x PNG / 质量 95 / 文件名 final', () => {
    expect(normalizeRenderOptions(undefined)).toEqual({
      deviceScaleFactor: 2,
      format: 'png',
      quality: 95,
      outputDir: '',
      filename: 'final',
    });
  });

  it('倍率夹到 1–4 的整数', () => {
    expect(normalizeRenderOptions({ deviceScaleFactor: 0 }).deviceScaleFactor).toBe(1);
    expect(normalizeRenderOptions({ deviceScaleFactor: 9 }).deviceScaleFactor).toBe(4);
    expect(normalizeRenderOptions({ deviceScaleFactor: 2.6 }).deviceScaleFactor).toBe(3);
    expect(normalizeRenderOptions({ deviceScaleFactor: Number.NaN }).deviceScaleFactor).toBe(2);
  });

  it('格式只认 jpeg，其余回 png', () => {
    expect(normalizeRenderOptions({ format: 'jpeg' }).format).toBe('jpeg');
    expect(normalizeRenderOptions({ format: 'webp' }).format).toBe('png');
    expect(normalizeRenderOptions({ format: 'PNG' }).format).toBe('png');
  });

  it('质量夹到 1–100', () => {
    expect(normalizeRenderOptions({ quality: -5 }).quality).toBe(1);
    expect(normalizeRenderOptions({ quality: 999 }).quality).toBe(100);
    expect(normalizeRenderOptions({ quality: 72.4 }).quality).toBe(72);
  });

  it('filename 只留 basename、去扩展名、过滤非法字符', () => {
    expect(normalizeRenderOptions({ filename: '../../etc/passwd' }).filename).toBe('passwd');
    expect(normalizeRenderOptions({ filename: '/tmp/海报 01.PNG' }).filename).toBe('海报_01');
    expect(normalizeRenderOptions({ filename: '..' }).filename).toBe('final');
    expect(normalizeRenderOptions({ filename: '   ' }).filename).toBe('final');
    expect(sanitizeRenderFilename('..\\..\\evil.png')).toBe('evil');
  });

  it('outputDir 只 trim，不在这里解析路径', () => {
    expect(normalizeRenderOptions({ outputDir: '  D:\\out  ' }).outputDir).toBe('D:\\out');
    expect(normalizeRenderOptions({ outputDir: 123 }).outputDir).toBe('');
  });
});
