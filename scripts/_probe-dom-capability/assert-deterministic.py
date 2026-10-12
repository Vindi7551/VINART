"""确定性断言：同一页面渲染两次，必须逐像素完全相同。
（对应项目原则「渲染 = 确定性纯函数」；程序化生成若用了非确定性随机，这里就会失败。）
用法：python assert-deterministic.py a.png b.png
"""
import sys
from pnglib import read_png, mad

a, b = sys.argv[1], sys.argv[2]
wa, ha, ca, pa = read_png(a)
wb, hb, cb, pb = read_png(b)
print(f'{a}: {wa}x{ha} ch={ca}')
print(f'{b}: {wb}x{hb} ch={cb}')

ok = True
if (wa, ha) != (wb, hb):
    print(f'   ❌ 尺寸不一致：{wa}x{ha} vs {wb}x{hb}')
    ok = False
else:
    print(f'   ✅ 尺寸一致')

if ca != cb:
    print(f'   ❌ 通道数不一致：{ca} vs {cb}')
    ok = False

if ok:
    d = mad(pa, pb, wa, ca)
    print(f'   两次渲染的 mean|Δ| = {d:.6f}')
    if d == 0.0:
        print('   ✅ 逐像素完全相同 —— 生成是确定性的（给定种子即复现）')
    else:
        nz = sum(1 for i in range(0, len(pa), max(1, ca)) if pa[i] != pb[i])
        print(f'   ❌ 存在差异（首通道不同字节数 ≈ {nz}）—— 生成引入了不确定性')
        ok = False

sys.exit(0 if ok else 1)
