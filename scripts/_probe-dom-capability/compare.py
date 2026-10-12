"""像素级对比：isolation:isolate 是否影响 mix-blend-mode 的跨层混合。
读 05-raw.png（340x750，三段各 250 高）。断言式（失败非 0 退出）。
复用 pnglib（通道数按 IHDR.colorType 走——本项目已两次踩过硬编码步长的坑）。"""
import sys
from pnglib import read_png, block, mad

W, BH = 340, 250
w, h, ch, px = read_png('05-raw.png')
print(f'图像 {w}x{h} 通道数={ch}')
assert (w, h) == (W, 3 * BH), f'尺寸不符，期望 {W}x{3*BH}，实际 {w}x{h}'

A = block(px, w, ch, 0, 0,      W, BH)  # isolation:isolate + multiply
B = block(px, w, ch, 0, BH,     W, BH)  # isolation:auto    + multiply
C = block(px, w, ch, 0, 2 * BH, W, BH)  # 无混合模式（基准）

ab_full = mad(A, B, W, ch)
ac_full = mad(A, C, W, ch)

# 笔画覆盖区（该区域内混合最集中）
X0, Y0, XW, XH = 60, 80, 245, 130
ab_roi = mad(block(px, w, ch, X0, Y0,      XW, XH),
             block(px, w, ch, X0, BH + Y0, XW, XH), XW, ch)
ac_roi = mad(block(px, w, ch, X0, Y0,      XW, XH),
             block(px, w, ch, X0, 2*BH + Y0, XW, XH), XW, ch)

print(f'全幅   mean|A-B| = {ab_full:7.4f}   mean|A-C| = {ac_full:7.4f}')
print(f'笔画区 mean|A-B| = {ab_roi:7.4f}   mean|A-C| = {ac_roi:7.4f}')
print()

ok = True
print('① isolation 是否挡住混合？')
if ab_full < 1.0 and ab_roi < 1.0:
    print(f'   ✅ 不挡 —— A(isolate) 与 B(auto) 逐像素几乎相同（{ab_full:.4f} / {ab_roi:.4f}）')
else:
    print(f'   ❌ 挡住 —— A 与 B 差 {ab_full:.3f} / {ab_roi:.3f}')
    ok = False

print('② 混合本身是否生效？（A 有 multiply，C 无）')
ratio = ac_roi / max(ab_roi, 1e-6)
if ac_roi > 2.0 and ratio > 20:
    print(f'   ✅ 生效 —— 笔画区 mean|A-C|={ac_roi:.2f}，是 mean|A-B| 的 {ratio:.0f} 倍')
else:
    print(f'   ⚠️ 判据未过：mean|A-C|={ac_roi:.2f}，比值 {ratio:.1f}')
    ok = False

sys.exit(0 if ok else 1)
