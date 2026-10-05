"""下载候选板衬线体的 latin 子集（含德语 ä/ö/ü/ß 所需的 U+0000-00FF）。

用 Google Fonts 的 CSS API：带现代 Chrome UA 才会返回 woff2。
从返回的 CSS 里挑 unicode-range 以 U+0000-00FF 开头的那一段（latin 子集），
避免把 cyrillic/vietnamese 等无关子集也拖下来。

产物：.tmp-run/fonts/<family>-<weight>.woff2（临时目录，选定后再提升进 designassets/fonts/）
"""

import os
import re
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

OUT = ".tmp-run/fonts"

# 家族 → 要下载的字重
CANDIDATES = {
    "Bitter": [400, 700, 900],
    "Roboto Slab": [400, 700, 900],
    "Zilla Slab": [400, 600, 700],
    "Noto Serif": [400, 700, 900],
    "Arvo": [400, 700],
    "Rokkitt": [400, 700, 900],
    "Alfa Slab One": [400],
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def latin_url(css: str) -> str | None:
    """从 CSS 里取出 latin 子集（unicode-range 以 U+0000-00FF 开头）的 woff2 地址。"""
    blocks = re.findall(r"@font-face\s*\{(.*?)\}", css, re.S)
    for b in blocks:
        if "U+0000-00FF" not in b:
            continue
        m = re.search(r"url\((https://[^)]+\.woff2)\)", b)
        if m:
            return m.group(1)
    return None


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    ok = 0
    for family, weights in CANDIDATES.items():
        q = family.replace(" ", "+")
        wq = ";".join(str(w) for w in weights)
        css_url = f"https://fonts.googleapis.com/css2?family={q}:wght@{wq}&display=swap"
        try:
            css = fetch(css_url).decode("utf-8")
        except Exception as e:
            print(f"  ✗ {family}: 取 CSS 失败 {e}")
            continue

        # 逐字重取 latin 地址（CSS 里按字重分段）
        got = []
        for w in weights:
            # 找到该字重所在的所有 block，取含 latin 的那个
            blocks = re.findall(r"@font-face\s*\{(.*?)\}", css, re.S)
            hit = None
            for b in blocks:
                if f"font-weight: {w}" not in b and f"font-weight:{w}" not in b:
                    continue
                if "U+0000-00FF" not in b:
                    continue
                m = re.search(r"url\((https://[^)]+\.woff2)\)", b)
                if m:
                    hit = m.group(1)
                    break
            if not hit:
                print(f"    ! {family} {w}: 未找到 latin 子集")
                continue
            safe = family.replace(" ", "")
            path = os.path.join(OUT, f"{safe}-{w}.woff2")
            try:
                data = fetch(hit)
                with open(path, "wb") as f:
                    f.write(data)
                got.append(f"{w}({len(data)//1024}KB)")
                ok += 1
            except Exception as e:
                print(f"    ! {family} {w}: 下载失败 {e}")

        print(f"  ✓ {family:<14} {' '.join(got)}")

    print(f"\n共下载 {ok} 个字体文件 → {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
