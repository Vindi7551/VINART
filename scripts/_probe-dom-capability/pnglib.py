"""极简 PNG 读取 + 像素比较工具（探针共用）。

⚠️ 关键坑：必须按 IHDR.colorType 决定通道数（2=RGB 三通道，6=RGBA 四通道）。
硬编码步长会导致取样错位（本项目已犯两次）。
"""
import struct, zlib


def read_png(path):
    """返回 (w, h, ch, pixels) —— pixels 是未过滤的原始字节。"""
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', f'{path} 不是 PNG'
    i, idat = 8, b''
    w = h = bd = ct = None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]
        typ = d[i+4:i+8]
        data = d[i+8:i+8+ln]
        i += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
    assert bd == 8, f'只支持 8bit，{path} 是 {bd}bit'
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    stride = w * ch
    raw = zlib.decompress(idat)
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if ft == 1:
            for x in range(ch, stride):
                line[x] = (line[x] + line[x-ch]) & 255
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0
                b = prev[x]
                c = prev[x-ch] if x >= ch else 0
                pp = a + b - c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, ch, bytes(out)


def color_type(path):
    d = open(path, 'rb').read()
    return struct.unpack('>B', d[8+8+9:8+8+10])[0]  # IHDR 的 colorType 字节


def block(px, w, ch, x0, y0, ww, hh):
    """从整幅里切一块 (ww×hh)，返回紧凑字节。"""
    out = []
    for y in range(y0, y0 + hh):
        row = y * w * ch
        out.append(px[row + x0*ch: row + (x0 + ww)*ch])
    return b''.join(out)


def mad(a, b, ww, ch):
    """同尺寸两块的平均绝对差（逐像素、按 ch 走；只比 RGB 三通道）。"""
    s = n = 0
    for y in range(len(a) // (ww * ch)):
        row = y * ww * ch
        for x in range(ww):
            o = row + x * ch
            s += abs(a[o]-b[o]) + abs(a[o+1]-b[o+1]) + abs(a[o+2]-b[o+2])
            n += 3
    return s / n


def nonzero_alpha_ratio(px, w, ch):
    """RGBA 里 alpha>0 的像素占比（用于确认"是不是真有内容"）。"""
    if ch != 4:
        return 1.0
    n = 0
    total = w * (len(px) // (w * ch))
    for i in range(3, len(px), 4):
        if px[i] > 0:
            n += 1
    return n / total
