"""变换型流水线断言：DOM 烘焙出的层，经光栅操作后必须"真的变了"。
断言式（失败非 0 退出）。"""
import sys
from pnglib import read_png, color_type, mad, nonzero_alpha_ratio

SRC = 'dom-layer.png'      # ① DOM 烘焙产物
OUT = 'raster-result.png'  # ② 光栅处理产物

ws, hs, cs, ps = read_png(SRC)
wo, ho, co, po = read_png(OUT)
print(f'① {SRC}: {ws}x{hs} ch={cs} colorType={color_type(SRC)}')
print(f'② {OUT}: {wo}x{ho} ch={co} colorType={color_type(OUT)}')

ok = True

if (ws, hs) != (wo, ho):
    print(f'   ❌ 尺寸不一致：{ws}x{hs} vs {wo}x{ho}')
    ok = False
else:
    print(f'   ✅ 尺寸一致 {ws}x{hs}')

if color_type(SRC) != 6:
    print(f'   ⚠️ ① 不是 RGBA（colorType={color_type(SRC)}）—— 透明背景截图可能没生效')
    ok = False
else:
    print('   ✅ ① 是 RGBA（透明底，烘焙出的是"图层"而非整幅合成）')

if color_type(OUT) != 6:
    print(f'   ❌ ② 不是 RGBA（colorType={color_type(OUT)}）—— 光栅层必须保留 alpha')
    ok = False
else:
    ar = nonzero_alpha_ratio(po, wo, co)
    if ar < 0.10:
        print(f'   ❌ ② alpha 覆盖仅 {ar*100:.1f}% —— 光栅结果几乎是空的')
        ok = False
    else:
        print(f'   ✅ ② 是 RGBA 且含内容（alpha 覆盖 {ar*100:.1f}%）')

# 光栅操作必须真的改变了像素
d = mad(ps, po, ws, cs)
print(f'   ①与②的平均绝对差 = {d:.2f}')
if d < 8.0:
    print('   ❌ 差异过小 —— 光栅操作没有真正生效')
    ok = False
else:
    print('   ✅ 光栅操作确实改变了像素（不是空跑）')

sys.exit(0 if ok else 1)
