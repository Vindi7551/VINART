/**
 * 顶点编辑 demo 用的**演示文档**。
 *
 * 三个多边形，各自负责验证一件事：
 * - `tri` —— 三条边，用来试「在边上点一下加个顶点，三角变四边」；
 * - `slab` —— 五个点，用来试拖点和删点；
 * - `rot` —— 转了 -8° 的三角，用来试**逆旋转**（屏幕上往右拖，点集里的位移
 *   必须先把角度转回去，否则拖出来是斜的）。
 *
 * ⚠️ **画布的孩子一律是图层**（元素住在图层里）⇒ 这些节点包在一个图层里。
 *    图层**永远和画布一样大** ⇒ 里面的元素仍然是**画布坐标**：
 *    下面这些数值与改结构之前**逐字相同**（一个换算都没做）。
 */

import type { DesignDocument } from '../../document/vocabulary';

export const DEMO_DOC: DesignDocument = {
  canvas: { width: 900, height: 600, background: '#FDF6EC' },
  layers: [
    {
      id: 'main',
      elements: [
        // 底板：省得点空白就取消选中，看不见选中框
        { id: 'bg', type: 'shape', kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 }, fill: '#FDF6EC' },

        {
          id: 'tri',
          type: 'shape',
          kind: 'polygon',
          rect: { x: 54, y: 72, w: 360, h: 432 },
          points: [
            [0.5, 0],
            [1, 1],
            [0, 1],
          ],
          fill: '#2F6B8A',
          stroke: { paint: '#120C07', width: 3, join: 'round' },
        },

        {
          id: 'slab',
          type: 'shape',
          kind: 'polygon',
          rect: { x: 468, y: 72, w: 378, h: 216 },
          points: [
            [0, 0.18],
            [0.22, 0],
            [1, 0],
            [0.82, 1],
            [0, 1],
          ],
          fill: '#E07A5F',
        },

        {
          id: 'rot',
          type: 'shape',
          kind: 'polygon',
          rect: { x: 495, y: 330, w: 324, h: 180 },
          points: [
            [0.5, 0],
            [1, 1],
            [0, 1],
          ],
          fill: '#3D9970',
          transform: { rotate: -8 },
        },

        // 文字：让属性面板有"内容 / 字号 / 颜色 / 字重"可改
        {
          id: 'title',
          type: 'text',
          frame: { x: 54, y: 516, w: 792 },
          runs: [{ text: 'Akazienholz Schneidebrett' }],
          fontSizePx: 50,
          fill: '#2B2B2B',
          align: 'left',
        },

        // 沿路径排字（`curve` = 正圆弧的简写）—— **另一条渲染路径**（SVG `textPath`）。
        // 用途有二：① demo 里能直接看到弧线字；② 让探针能钉住"弧线字**不能就地打字**"这条边界。
        {
          id: 'arc',
          type: 'text',
          // ⚠️ 路径文字（`curve`）**必须有 `h`** —— viewBox 的长宽比是输入，不是排版结果
          frame: { x: 36, y: 12, w: 450, h: 54 },
          runs: [{ text: 'handgefertigt · mit Liebe' }],
          fontSizePx: 29,
          fill: '#B8722F',
          align: 'center',
          curve: 0.45,
        },

        // ⭐ **组**：整体旋转 + 整体淡出（这正是"组"存在的理由）。
        //    里面还套了一个**外部 svg**（`leaf`）—— 两类新节点都在这里。
        // ⭐ 解析形状（ellipse）—— 配合「升格」：选中它能看到 24 个等效顶点，
        //    拖任意一个（或点边）就转成可编辑的 polygon（单向不可逆）
        { id: 'oval', type: 'shape', kind: 'ellipse', rect: { x: 612, y: 522, w: 198, h: 48 }, fill: '#B8722F' },

        {
          id: 'pack',
          type: 'group',
          transform: { rotate: -8 },
          opacity: 0.9,
          elements: [
            // ⚠️ 尺寸压小、放在右上角那条空带里（y ≤ 0.10）—— 再大就盖住 `slab` 的顶点手柄，
            //    那些手柄是探针要点的（实测踩过：盖住之后"顶点拿不到位置"）
            // ⚠️ 这里特意用 **`polygon`**（不是 `rect`）：`shape` 有两条渲染路线 ——
            //    `rect`/`ellipse` 走 **CSS**，`polygon`/`path` 走**内嵌 `<svg>`**（所以只有它们能逐点编辑）。
            //    放一个 `polygon` 进来，才能钉住"组里的多边形**不给顶点编辑**"这条守卫。
            {
              id: 'chip',
              type: 'shape',
              kind: 'polygon',
              rect: { x: 558, y: 12, w: 270, h: 48 },
              points: [
                [0.03, 0],
                [1, 0.06],
                [0.97, 1],
                [0, 0.94],
              ],
              fill: '#2F6B8A',
            },
            { id: 'leaf', type: 'svg', asset: 'ahorn.svg', rect: { x: 675, y: 15, w: 45, h: 42 } },
          ],
        },
      ],
    },
  ],
};

/**
 * demo 用的**素材表**（内联 data URL）。
 *
 * ⚠️ demo 页是**自包含**的（双击即开、不依赖外部文件），所以素材必须内联 ——
 * 这也和正式链路一致：`emitDocument` 不读盘，素材一律由调用方以**值**注入。
 */
export const DEMO_ASSETS: Record<string, string> = {
  'ahorn.svg':
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 4 L61 40 L96 50 L61 60 L50 96 L39 60 L4 50 L39 40 Z" fill="#FFFDF8"/></svg>',
    ),
};
