# DOM / CSS / SVG 能力清单 —— 矢量侧的上限

> **这份清单只回答一件事：用 HTML + CSS + SVG（在 Chromium 里）能表达什么。**  
> 组织方式：按**能力类别**；每条给出「能做什么 → 靠什么 → 边界」。  
> **末尾有「做不到的」清单**——那才是规划时真正的约束。
>
> 日期：2026-10-13 · 相关：`docs/PHOTOSHOP-CAPABILITIES.md`（PS 侧对照）、`docs/HYBRID-RENDERING.md`

---

## 〇、一句话总纲

**DOM 侧能表达的范围 = 「声明式矢量 + 位图作为素材 + 属性级效果」。**

它**不等于**"图像处理软件"——**没有像素级操作**。凡是"逐像素改"（画笔、液化、修复），  
都要走 Canvas / WebGPU（位图侧），不在这份清单里。

---

## 一、布局与几何

| 能做什么        | 靠什么                                                                  | 边界                   |
| ----------- | -------------------------------------------------------------------- | -------------------- |
| 放到任意位置、任意尺寸 | `position: absolute` + `left/top/width/height`                       | 用比例（0–1）乘画布尺寸即可      |
| 按父容器分块排     | Flexbox / Grid                                                       | 对"固定版式"其实用不上，但可做内部对齐 |
| 叠放顺序        | **DOM 顺序** 或 `z-index`                                               | 同层叠上下文内              |
| 裁剪溢出        | `overflow: hidden/clip`                                              | —                    |
| 保持宽高比       | `aspect-ratio`                                                       | —                    |
| 图怎么装进框      | `object-fit: cover/contain/fill/none/scale-down` + `object-position` | —                    |
| 文字绕开一个形状    | `shape-outside` + `shape-margin`                                     | 只在浮动布局里生效            |
| 吸附/对齐       | ⚠️ **无**（CSS 没有"对齐到别的元素"）                                            | 只能靠算坐标（见 §十三）        |

---

## 二、变换（不参与布局）

| 能做什么              | 靠什么                                                                              |
| ----------------- | -------------------------------------------------------------------------------- |
| 平移 / 旋转 / 缩放 / 斜切 | `transform: translate() rotate() scale() skew()`                                 |
| 平移 / 旋转 / 缩放 / 斜切 | `transform: translate() rotate() scale() skew()`                                 |
| 任意 2D 矩阵          | `matrix(a,b,c,d,e,f)`                                                            |
| 任意 2D 矩阵          | `matrix(a,b,c,d,e,f)`                                                            |
| 独立属性写法            | `translate` / `rotate` / `scale`（CSS Transforms L2）                              |
| 独立属性写法            | `translate` / `rotate` / `scale`（CSS Transforms L2）                              |
| 支点                | `transform-origin`                                                               |
| 支点                | `transform-origin`                                                               |
| 3D 旋转 / 透视        | `perspective()` / `rotate3d()` / `translateZ()` + `transform-style: preserve-3d` |
| 3D 旋转 / 透视        | `perspective()` / `rotate3d()` / `translateZ()` + `transform-style: preserve-3d` |
| 背面隐藏              | `backface-visibility`                                                            |
| 背面隐藏              | `backface-visibility`                                                            |

⚠️ **变换不改变布局**——`rect` 仍是变换前的矩形（这是它和几何分开的理由）。

---

## 三、颜色与涂装

| 能做什么               | 靠什么                                                                  |
| ------------------ | -------------------------------------------------------------------- |
| 纯色填充               | `background-color` / `color` / `fill`                                |
| **线性 / 径向 / 锥形渐变** | `linear-gradient()` / `radial-gradient()` / `conic-gradient()`       |
| **重复渐变**           | `repeating-linear-gradient()` 等                                      |
| **多个背景层叠**         | `background: url(), linear-gradient(), …`                            |
| 图案填充               | `background-image`（PNG/SVG）+ `background-repeat` / `background-size` |
| **把渐变/图填进文字笔画**    | `background-clip: text`                                              |
| 渐变到透明、硬边色标         | `linear-gradient()` 的色标                                              |
| 现代色空间              | `oklch()` / `lab()` / `color(display-p3 …)`                          |
| 跟随父级颜色             | `currentColor`                                                       |
| 半透明                | `rgba()` / 8 位 hex / `opacity`                                       |

---

## 四、边框、描边与阴影

| 能做什么                 | 靠什么                                                        | 边界                               |
| -------------------- | ---------------------------------------------------------- | -------------------------------- |
| 描边（沿盒模型）             | `border` / `outline` + `outline-offset`                    | ⚠️ **`outline` 不跟随 `clip-path`** |
| 圆角（**四角独立**、椭圆角）     | `border-radius: a b c d / e f g h`                         | —                                |
| **外阴影 / 内阴影 / 多重阴影** | `box-shadow`（含 `inset`，可逗号叠多组）                             | 沿**盒子**，非沿任意轮廓                   |
| **沿真实轮廓的阴影**         | `filter: drop-shadow()`                                    | ✅ 跟随形状/透明区                       |
| 文字阴影                 | `text-shadow`（可叠多层）                                        | —                                |
| 文字描边                 | `-webkit-text-stroke`                                      | 非标准，Chromium 可用                  |
| 每边不同描边               | `border-*`                                                 | —                                |
| **用图片当边框**           | `border-image` + `slice`                                   | —                                |
| SVG 内描边              | `stroke` / `stroke-width`                                  | ⚠️ **沿线恒定宽度**（见 §十三）             |
| 虚线描边                 | `stroke-dasharray` + `stroke-dashoffset`                   | —                                |
| 端点/拐角样式              | `stroke-linecap` / `stroke-linejoin` / `stroke-miterlimit` | —                                |
| 描边在填充下/上             | `paint-order`                                              | SVG                              |

---

## 五、文字排版

| 能做什么                      | 靠什么                                                        |
| ------------------------- | ---------------------------------------------------------- |
| 字体族 / 字号 / 字重 / 斜体 / 拉伸   | `font-family/size/weight/style/stretch`                    |
| 字体族 / 字号 / 字重 / 斜体 / 拉伸   | `font-family/size/weight/style/stretch`                    |
| **内联字体**（不依赖系统）           | `@font-face` + `src: url(data:font/woff2;base64,…)`        |
| **内联字体**（不依赖系统）           | `@font-face` + `src: url(data:font/woff2;base64,…)`        |
| **可变字体**（连续字重/字宽轴）        | `font-variation-settings` / `font-optical-sizing`          |
| **可变字体**（连续字重/字宽轴）        | `font-variation-settings` / `font-optical-sizing`          |
| OpenType 特性（连字、旧体数字、小型大写） | `font-feature-settings` / `font-variant-*`                 |
| OpenType 特性（连字、旧体数字、小型大写） | `font-feature-settings` / `font-variant-*`                 |
| 字距 / 词距 / 行高              | `letter-spacing` / `word-spacing` / `line-height`          |
| 字距 / 词距 / 行高              | `letter-spacing` / `word-spacing` / `line-height`          |
| 对齐（含两端、最后一行）              | `text-align` / `text-align-last`                           |
| 对齐（含两端、最后一行）              | `text-align` / `text-align-last`                           |
| 首行缩进 / 整块缩进               | `text-indent` / `padding`                                  |
| 首行缩进 / 整块缩进               | `text-indent` / `padding`                                  |
| 大小写 / 小型大写                | `text-transform` / `font-variant-caps`                     |
| 大小写 / 小型大写                | `text-transform` / `font-variant-caps`                     |
| 下划线 / 删除线（样式、颜色、粗细、线型）    | `text-decoration` + `-color` / `-style` / `-thickness`     |
| 下划线 / 删除线（样式、颜色、粗细、线型）    | `text-decoration` + `-color` / `-style` / `-thickness`     |
| 换行控制                      | `white-space` / `overflow-wrap` / `word-break` / `hyphens` |
| 换行控制                      | `white-space` / `overflow-wrap` / `word-break` / `hyphens` |
| 溢出省略号                     | `text-overflow: ellipsis`                                  |
| 溢出省略号                     | `text-overflow: ellipsis`                                  |
| **竖排 / 从右往左**             | `writing-mode` / `direction`                               |
| **竖排 / 从右往左**             | `writing-mode` / `direction`                               |
| 首字下沉                      | `initial-letter`                                           |
| 首字下沉                      | `initial-letter`                                           |
| 基线微调 / 上下标                | `vertical-align` / `baseline-shift`（SVG）/ `<sub>` `<sup>`  |
| 基线微调 / 上下标                | `vertical-align` / `baseline-shift`（SVG）/ `<sub>` `<sup>`  |
| **沿路径排字**                 | SVG `<textPath>`（CSS 无此能力）                                 |
| **沿路径排字**                 | SVG `<textPath>`（CSS 无此能力）                                 |
| 文字分段内联样式                  | `<span>` 逐段（**这就是 runs 的实现方式**）                            |
| 文字分段内联样式                  | `<span>` 逐段（**这就是 runs 的实现方式**）                            |
| 文字环绕形状                    | `shape-outside`                                            |
| 文字环绕形状                    | `shape-outside`                                            |
| 文字渐隐/遮罩                   | `mask-image` + 渐变                                          |
| 文字渐隐/遮罩                   | `mask-image` + 渐变                                          |

⚠️ **没有**：信封变形（envelope warp）、真正的网格文字变形、任意逐字旋转（要每字一个元素）

---

## 六、遮罩与裁剪

| 能做什么                      | 靠什么                                                          |
| ------------------------- | ------------------------------------------------------------ |
| **任意多边形 / 圆 / 椭圆 / 路径裁剪** | `clip-path: inset() circle() ellipse() polygon() path()`     |
| 引用 SVG 裁剪路径               | `clip-path: url(#myClip)`                                    |
| **用图片/渐变当蒙版**（灰度或 alpha）  | `mask-image` + `mask-size` / `mask-position` / `mask-repeat` |
| **多蒙版层**                  | `mask-image: a, b`                                           |
| 蒙版合成模式                    | `mask-composite: add / subtract / intersect / exclude`       |
| 蒙版按亮度 or 透明度              | `mask-mode: luminance / alpha`                               |
| 用 SVG 定义蒙版                | `<mask>` + `mask-type`                                       |
| **用 SVG 生成不规则边缘**         | `<feTurbulence>` + `<feDisplacementMap>` 造 mask（实测可行）        |
| 整体淡出 / 边缘羽化               | 渐变蒙版                                                         |

⚠️ **没有**：蒙版的**布尔运算**（并/交/差）能做的很有限（`mask-composite` 只有 4 种，且不能组合出任意集合）。

---

## 七、滤镜与图像算子（**DOM 侧最被低估的一块**）

### 7.1 CSS `filter`（一行一个算子，原生 + GPU）

`blur` · `brightness` · `contrast` · `drop-shadow` · `grayscale` ·  
`hue-rotate` · `invert` · `opacity` · `saturate` · `sepia`

### 7.2 `backdrop-filter`（对**背后内容**做滤镜，可做毛玻璃）

### 7.3 ⭐ SVG 滤镜原语（**这就是一套原生的图像处理算子库**）

| 原语                                                         | 等价于                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `feGaussianBlur`                                           | 高斯模糊                                                                                                                           |
| `feColorMatrix`                                            | **通道混合 / 色相旋转 / 饱和度 / 亮度**                                                                                                     |
| `feComponentTransfer`                                      | **曲线 / 色阶 / 伽马**（逐通道映射表）                                                                                                       |
| `feBlend`                                                  | 混合模式（normal / multiply / screen / darken / lighten）                                                                            |
| `feComposite`                                              | 合成运算（over / in / out / atop / xor / arithmetic）                                                                                |
| `feFlood` + `feMerge`                                      | 填充层 + 图层合并                                                                                                                     |
| `feOffset`                                                 | 位移（做投影）                                                                                                                        |
| `feDropShadow`                                             | 投影（一步）                                                                                                                         |
| `feMorphology`                                             | **膨胀 / 腐蚀**（加粗、瘦身、描边外扩）                                                                                                        |
| `feTurbulence`                                             | **噪声 / 纹理 / 颗粒**                                                                                                               |
| `feDisplacementMap`                                        | **位移扭曲**（波浪、做旧、撕裂边）                                                                                                            |
| `feConvolveMatrix`                                         | **任意卷积核**（锐化、浮雕、边缘检测）                                                                                                          |
| `feDiffuseLighting` / `feSpecularLighting`                 | **光照效果**（配合 `fePointLight` / `feDistantLight` / `feSpotLight`）                                                                 |
| `feTile`                                                   | 平铺（把滤镜区域内的一块平铺开）                                                                                                               |
| `feImage`                                                  | 引入一张图像 ⚠️ **实测（2026-10-13）：Chromium 里不加载外部 SVG / data URI 的 SVG** —— 蒙版会变成空的，滤镜静默失效。**别依赖它做空间蒙版**（见 §十三）。改用 §六 的 `mask-image`。 |
| `feColorMatrix type="saturate/hueRotate/luminanceToAlpha"` | 快捷写法                                                                                                                           |



**整套用 `filter: url(#myFilter)` 挂到任意元素上。**  
⚠️ 全部**原生 + 确定性**；`feTurbulence` 的 `seed` 固定 ⇒ **完全可复现**。

---

## 八、合成与混合（层与层之间）

| 能做什么                                                                                                                                                                                       | 靠什么                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| **16 种混合模式**：normal / multiply / screen / overlay / darken / lighten / color-dodge / color-burn / hard-light / soft-light / difference / exclusion / hue / saturation / color / luminosity | `mix-blend-mode`        |
| 背景层之间的混合                                                                                                                                                                                   | `background-blend-mode` |
| 组的整体透明度                                                                                                                                                                                    | `opacity`（在父容器上）        |
| **阻断混合外溢**                                                                                                                                                                                 | `isolation: isolate`    |
| SVG 内混合                                                                                                                                                                                    | `feBlend` 的 `mode`      |

⚠️ **混合模式的上限是 16 种**（PS 有 27）；缺 `subtract` / `divide` / `linear-burn` / `vivid-light` 等  
——**要全 27 种需自建合成器**（见 `docs/HYBRID-RENDERING.md` §3）。

---

## 九、矢量图形（SVG 元素）

| 能做什么               | 靠什么                                                               |
| ------------------ | ----------------------------------------------------------------- |
| **任意轮廓（含贝塞尔曲线）**   | `<path d="M… C… Z">`                                              |
| 基本形状               | `<rect>` `<circle>` `<ellipse>` `<line>` `<polyline>` `<polygon>` |
| **分组**（整体变换/透明/裁剪） | `<g>`                                                             |
| **复用**（一次定义多处引用）   | `<symbol>` + `<use href="#x">`                                    |
| 图元库                | `<defs>`                                                          |
| 文字                 | `<text>` `<tspan>` `<textPath>`                                   |
| 灰度图/位图嵌入           | `<image>`                                                         |
| **在 SVG 里放 HTML**  | `<foreignObject>`                                                 |
| 箭头/端点标记            | `<marker>`                                                        |
| 渐变 / 图案定义          | `<linearGradient>` `<radialGradient>` `<pattern>`                 |
| 裁剪 / 蒙版定义          | `<clipPath>` `<mask>`                                             |
| 滤镜定义               | `<filter>`                                                        |

⚠️ **没有布尔路径运算**（并/交/差）——需要几何库（如 paper.js / clipper）先算，再输出新路径。

---

## 十、图像（位图作为"素材"）

| 能做什么            | 靠什么                                                     |
| --------------- | ------------------------------------------------------- |
| 引用图片            | `<img src>` / `background-image: url()` / SVG `<image>` |
| 引用图片            | `<img src>` / `background-image: url()` / SVG `<image>` |
| 完整嵌入（不依赖外部文件）   | **data URL**（base64）                                    |
| 完整嵌入（不依赖外部文件）   | **data URL**（base64）                                    |
| 装填方式            | `object-fit` / `object-position` / `background-size`    |
| 装填方式            | `object-fit` / `object-position` / `background-size`    |
| 缩放质量            | `image-rendering: auto / pixelated / crisp-edges`       |
| 缩放质量            | `image-rendering: auto / pixelated / crisp-edges`       |
| **染色（单色图变任意色）** | `mask-image` + `background-color`，或 SVG `currentColor`  |
| **染色（单色图变任意色）** | `mask-image` + `background-color`，或 SVG `currentColor`  |
| 裁剪成任意形状         | `clip-path` / `mask-image`                              |
| 裁剪成任意形状         | `clip-path` / `mask-image`                              |

⚠️ **`<img>` 里的 SVG 不能用 `currentColor` 染色**——要染色必须内联或走 mask。

---

## 十一、3D

| 能做什么                 | 靠什么                                             |
| -------------------- | ----------------------------------------------- |
| 透视 / 绕 3D 轴旋转 / Z 位移 | `perspective()` / `rotate3d()` / `translateZ()` |
| 保留 3D 空间             | `transform-style: preserve-3d`                  |
| 背面隐藏                 | `backface-visibility`                           |

⚠️ **不是 3D 渲染**——只有"把平面元素摆进 3D 空间"。

---

## 十二、分组与复用

| 能做什么                          | 靠什么                          |
| ----------------------------- | ---------------------------- |
| **把多个元素当一个整体变换 / 加蒙版 / 调透明度** | SVG `<g>` / HTML 容器          |
| 复用一套定义                        | `<use>` / `<symbol>` / CSS 类 |
| 层叠上下文隔离                       | `isolation` / `z-index`      |

⚠️ **CSS 变量（`var()`）** 可以做出"一套定义、多处使用"的效果。

---

## 十三、★ **做不到的**（规划时的真正约束）

| 做不到                         | 说明                          | 替代路径                                      |
| --------------------------- | --------------------------- | ----------------------------------------- |
| **变宽描边**（沿路径粗细变化）           | SVG `stroke-width` **沿线恒定** | 自己算法向偏移生成轮廓（可行，见探针 `06-programmatic-gen`） |
| **布尔路径运算**（并/交/差/排除）        | 无原生支持                       | 几何库先算                                     |
| **网格渐变（mesh gradient）**     | CSS 只有线性/径向/锥形              | SVG 近似 / 位图                               |
| **任意形状的网格变形 / 液化**          | 无                           | 位图侧（Canvas/WebGPU）                        |
| **压感笔刷 / 笔迹累积**             | 无                           | 位图侧                                       |
| **像素级编辑**（涂抹、修复、内容识别）       | 无                           | 位图侧 / AI 模型                               |
| **沿路径自由排印**（复杂图文混排）         | `textPath` 只能简单沿路径          | —                                         |
| **信封变形 / 自由变形文字**           | 无                           | 位图侧                                       |
| **27 种混合模式**                | CSS 只有 16                   | 自建合成器                                     |
| **精确色彩管理**（CMYK / ICC / 印刷） | 浏览器为 sRGB/display-p3        | —                                         |
| **真正的 3D 几何**               | 只有平面元素进 3D 空间               | —                                         |
| **声明式对齐关系**（"左边对齐到 X"）      | CSS 无此概念                    | 算坐标                                       |

---

## 十四、一句话

> **DOM 侧 = 「声明式矢量」+「位图当素材」+「属性级效果」。**  
> 它的强项是**文字、渐变、描边、阴影、蒙版、滤镜原语**；  
> 它的天花板&#x5728;**"逐像素"**——凡是要改像素的，都不在这里。

---

## 附：与 PS 能力的对照

逐条迁移性分级（A 浏览器原生 / B 需 SVG / C 需光栅后端 / D 不该迁）见  
**`docs/PHOTOSHOP-CAPABILITIES.md` §2**。
