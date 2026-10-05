"""把下载好的候选字体整理成资产库结构。

`designassets/fonts/families/<Family>/`
    family.json      元数据：可用字重、授权、来源、气质备注
    <weight>.woff2   字体文件（latin 子集，覆盖德语 ä/ö/ü/ß）

字体是**参数**不是常量——多个家族并存，由排版方案（schemes/*.json）挑选组合，
规格再引用方案名。这与调色板的做法一致。
"""

import json
import os
import shutil

SRC = ".tmp-run/fonts"
DST = "designassets/fonts/families"

# 家族 → 元数据
FAMILIES = {
    "Bitter": {
        "weights": [400, 700, 900],
        "license": "OFL-1.1",
        "character": "低对比、大 x-height、有墨陷细节。编辑/新闻气质，笔画扎实。",
        "bestFor": "需要字重全、观感稳重的标题",
    },
    "RobotoSlab": {
        "family": "Roboto Slab",
        "weights": [400, 700, 900],
        "license": "Apache-2.0",
        "character": "几何骨架、偏机械；与 Roboto 同度量，Material Design 血统。",
        "bestFor": "需要 900 极重、且能接受 Google/安卓气质",
    },
    "ZillaSlab": {
        "family": "Zilla Slab",
        "weights": [400, 600, 700],
        "license": "OFL-1.1",
        "character": "尖角板衬线、略窄、带人文书法细节。Mozilla 品牌字体。",
        "bestFor": "需要有个性但不想太重的标题；⚠️ 最高只到 700",
    },
    "Arvo": {
        "weights": [400, 700],
        "license": "OFL-1.1",
        "character": "几何方块衬线，硬朗不妥协——多个来源称其最接近 Rockwell。",
        "bestFor": "要 Rockwell 那种几何板衬线观感；⚠️ 仅两档字重",
    },
    "Rokkitt": {
        "weights": [400, 700, 900],
        "license": "OFL-1.1",
        "character": "几何板衬线，干净现代，品牌包袱最轻。",
        "bestFor": "需要多字重、又不想带任何品牌联想",
    },
    "AlfaSlabOne": {
        "family": "Alfa Slab One",
        "weights": [400],
        "license": "OFL-1.1",
        "character": "极重、近乎无可视内部空间，海报式展示字。",
        "bestFor": "只要两三个词的超重标题；⚠️ 仅一档，句子一长就糊",
    },
    "NotoSerif": {
        "family": "Noto Serif",
        "weights": [400, 700, 900],
        "license": "OFL-1.1",
        "character": "⚠️ 不是板衬线，是过渡衬线（细横笔、高对比）。",
        "bestFor": "对照用；不要当板衬线选",
    },
}


def main() -> None:
    if not os.path.isdir(SRC):
        raise SystemExit(f"找不到 {SRC}，先跑 scripts/_fetch-fonts.py")

    os.makedirs(DST, exist_ok=True)
    total = 0

    for dirname, meta in FAMILIES.items():
        fam_name = meta.get("family", dirname)
        target = os.path.join(DST, dirname)
        os.makedirs(target, exist_ok=True)

        copied = []
        for w in meta["weights"]:
            src = os.path.join(SRC, f"{dirname}-{w}.woff2")
            if not os.path.exists(src):
                print(f"  ! {dirname} {w}: 缺文件 {src}")
                continue
            dst = os.path.join(target, f"{w}.woff2")
            shutil.copyfile(src, dst)
            copied.append(w)
            total += 1

        record = {
            "family": fam_name,
            "dir": dirname,
            "weights": copied,
            "files": {str(w): f"{w}.woff2" for w in copied},
            "license": meta["license"],
            "source": "Google Fonts",
            "subset": "latin (U+0000-00FF) — 覆盖德语 ä/ö/ü/ß",
            "character": meta["character"],
            "bestFor": meta["bestFor"],
        }
        with open(os.path.join(target, "family.json"), "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
            f.write("\n")

        print(f"  ✓ {fam_name:<14} 字重 {copied}")

    print(f"\n共 {total} 个字体文件 → {os.path.abspath(DST)}")


if __name__ == "__main__":
    main()
