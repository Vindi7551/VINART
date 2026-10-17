import type { ReactNode } from 'react';

import { fieldsFor, fieldsForLayer, type Field, type SelectionSnapshot } from '../editor/inspector';
import { findElement, findLayer, type ElementNode } from '../document/vocabulary';
import { SelectionStylePanel } from './SelectionStylePanel';
import { Button, Field as FieldRow, FieldGrid, Hint, ListItem, Panel, PanelBody, PanelHeader, Row, Section } from './primitives';
import { FieldControl, isCheckKind, isWideKind } from './field-control';
import {
  IconCurve,
  IconDown,
  IconEye,
  IconEyeOff,
  IconFont,
  IconFrame,
  IconGlyph,
  IconImage,
  IconLayers,
  IconLock,
  IconParagraph,
  IconRotate,
  IconStroke,
  IconSwatch,
  IconTrash,
  IconType,
  IconUnderline,
  IconUnlock,
  IconUp,
} from './icons';
import { fieldsOfTool, TOOLS, type ToolId } from './tools';
import type { PreviewData, HostSignal } from './types';

/**
 * 版式编辑面板 —— **独立一栏**（`.inspector-col`，贴在画布右侧）。
 *
 * ## ⭐ 这一版的核心变化：**页驱动，不是手风琴**（2026-10-16）
 *
 * 左边工具栏选了哪个工具，这一栏就**整块换成那一页**。原来是把该节点的
 * **全部字段平铺**、靠"展开/收起"加减（文字节点 36 个字段）。
 *
 * 现在两级层次：
 *
 * ```
 * 工具页（左栏选，一次只看一类）
 *   └── 小节（这一页里的字段分类，带图标 —— 不再折叠）
 * ```
 *
 * | 原来 | 现在 |
 * |---|---|
 * | 36 个字段平铺 + 手风琴折叠 | 一页只看一类；`选择`页 6 个、`文字`页 27 个 |
 * | 字段行/图层行/输入框**内联硬编码**（`#e8f0fe` / `#555`） | 全部走基元层，样式落 `.ui-*` token |
 * | 图层 18 行 × `上/下/删` 文字按钮 | 图层**限高可滚** + **图标**动作（hover/选中才出现） |
 * | 撤销/重做/保存/出图 在这里 | **搬到工具栏**（同一动作不留两处入口） |
 *
 * ⚠️ 字段清单仍然全部来自 `fieldsFor`（词汇字段的单一真源）—— **这一版只改编排，没动数据**。
 *
 * ## ⚠️ 取值一律走 `Field.get`，**不要**自己拿 `path` 去拆
 *
 * `Field` 的 `path` 只是**标识**（UI 当 key），**不是取值路径**：
 * `runs[1].text` 按 `.` 拆出来是 `"runs[1]"`，**不是属性名** ⇒ 取不到（多片段全空框）。
 */

const TYPE_NAMES: Record<string, string> = {
  text: '文字',
  rect: '矩形',
  ellipse: '椭圆',
  polygon: '多边形',
  path: '路径',
  image: '图片',
  svg: '图标',
  group: '组',
};

/**
 * 小节图标（这一页里的**字段分类**）。
 *
 * ⚠️ 分类名是 `inspector.ts` 给的**中文字符串**，这里是一一对应的映射；
 *    加了分类忘配图标 ⇒ 那一节没图标（不会崩）。
 */
const GROUP_ICON: Record<string, ReactNode> = {
  位置: <IconFrame />,
  变换: <IconRotate />,
  内容: <IconType />,
  字体: <IconFont />,
  描边: <IconStroke />,
  排版: <IconParagraph />,
  沿路径: <IconCurve />,
  装饰: <IconUnderline />,
  字形: <IconGlyph />,
  外观: <IconSwatch />,
  图片: <IconImage />,
};

/** 结构性信号的类型（App 负责 seq 包装） */
export type EditSignal = Omit<HostSignal, 'seq'>;

interface EditPanelProps {
  layout: PreviewData;
  selectedLayer: string | null;
  /**
   * ⭐ **当前图层**（"新增元素进哪一层"，也是编辑器里唯一能被选中的范围）。
   *
   * 与 `selectedLayer` **不是一回事**：点元素时 `selectedLayer` 变、这个**不变**。
   * 图层行用它画**阴影**（Procreate 那种"我在这层干活"的提示）。
   */
  currentLayerId: string | null;
  busy: boolean;
  /** ⭐ 文字选区快照（在画面上选了字才有）；驱动顶部那一栏"选中的字" */
  selection?: SelectionSnapshot | null;
  /** ⭐ 当前工具页（左栏选的）—— 决定这一栏显示哪一类字段 */
  tool: ToolId;
  onSelectLayer: (id: string) => void;
  /** 单字段 patch（path + value）——编辑器内部改 doc，onChange 统一回流 */
  onLayerPatch: (id: string, path: string, value: unknown) => void;
  /** ⭐ 给**选中的那几个字**刷样式（path 来自 selectionFields） */
  onSelectionStyle: (path: string, value: unknown) => void;
  /** 图层操作信号（增删/排序/撤销/重做） */
  onSignal: (sig: EditSignal) => void;
}

export function EditPanel({
  layout,
  selectedLayer,
  currentLayerId,
  busy,
  selection,
  tool,
  onSelectLayer,
  onLayerPatch,
  onSelectionStyle,
  onSignal,
}: EditPanelProps) {
  // ⚠️ 找的是**元素**（含嵌套）：`doc.layers` 现在是**图层**，元素在 `Layer.elements` 里。
  const node = findElement(layout.doc, selectedLayer);
  /** 选中的是不是**图层本身**（那样面板显示"这张面"的属性，而不是元素的） */
  const layer = findLayer(layout.doc, selectedLayer);
  // ⚠️ 面板里**只放「不透明度」**：显示/锁定已经摆在图层行上（像 PS 那样），
  //    再在属性页里放一遍会让人以为"有两处开关"。字段表里之所以保留它们，
  //    是因为编辑器的 `patch` 要靠 `findLayerField('visible'|'locked')` 拿到 setter。
  const layerFields = layer ? fieldsForLayer().filter((f) => f.path !== 'visible' && f.path !== 'locked') : [];
  const allFields = node ? fieldsFor(node, layout.doc.canvas) : [];
  const shown = fieldsOfTool(allFields, tool);
  const toolDef = TOOLS.find((t) => t.id === tool);

  /** 这一页里再按 `group` 归拢（保持 `fieldsFor` 给的顺序）—— 页内的小节标题 */
  const groups: Array<{ title: string; fields: Field[] }> = [];
  for (const f of shown) {
    let g = groups.find((x) => x.title === f.group);
    if (!g) {
      g = { title: f.group, fields: [] };
      groups.push(g);
    }
    g.fields.push(f);
  }

  /** ⭐ 唯一取值入口：一律问字段自己（它知道单位、知道片段在哪个数组里） */
  const valueOf = (f: Field): unknown => (node ? f.get(node) : undefined);

  const commit = (f: Field, value: unknown) => {
    if (!node) return;
    onLayerPatch(node.id, f.path, value);
  };

  /** 图层动作按钮：图标 + tooltip，点的时候别把"选中这一行"也触发了 */
  const layerAction = (title: string, icon: ReactNode, run: () => void) => (
    <Button
      variant="ghost"
      className="sq tiny"
      disabled={busy}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      {icon}
    </Button>
  );

  /**
   * **递归摊开一个容器里的元素**（组里还能是组）。缩进按深度算。
   *
   * ⚠️ 倒序：数组后面的画在上面 ⇒ 清单顶部 = 最上层（和图层行一致）。
   * ⚠️ 只是**面板**展开；画布上"点空白选中某个组"仍只认直接待在图层里的组
   *    （内层组靠点它的成员来选，走 `outermostGroupOf`）。
   */
  const elementRows = (els: ElementNode[], depth: number): ReactNode =>
    [...els].reverse().map((e) => (
      <div key={e.id}>
        <ListItem active={selectedLayer === e.id} onClick={() => onSelectLayer(e.id)}>
          <span className="layer-name layer-name-el" style={{ paddingLeft: 12 + depth * 12 }}>
            {TYPE_NAMES[e.type] ?? e.type} · {e.id}
          </span>
          <span className="ui-layer-actions">
            {layerAction('上移一个', <IconUp />, () => onSignal({ type: 'up', id: e.id }))}
            {layerAction('下移一个', <IconDown />, () => onSignal({ type: 'down', id: e.id }))}
            {layerAction('删除', <IconTrash />, () => onSignal({ type: 'remove', id: e.id }))}
          </span>
        </ListItem>
        {e.type === 'group' ? elementRows(e.elements, depth + 1) : null}
      </div>
    ));

  return (
    <Panel>
      <PanelHeader
        title="版式编辑"
        subtitle={node ? `${TYPE_NAMES[node.type] ?? node.type} · ${node.id}` : toolDef?.label}
      />
      <PanelBody>
        {/* ⭐ 画面上选了字 ⇒ 最上面先摆"选中的字"。
            它是**片段级**样式（只改那几个字），与下面的**节点级**表单是两回事，
            所以独立一块、置顶、带强调色 —— 免得让人以为下面那些框也改的是这几个字。 */}
        <SelectionStylePanel selection={selection ?? null} onStyle={onSelectionStyle} />

        {/* 这一页能"新增"什么（新增入口跟着工具走，工具栏就不必塞 7 个按钮） */}
        {toolDef?.adds?.length ? (
          <Section title="新增" icon={toolDef.icon} collapsible={false}>
            <Row>
              {toolDef.adds.map((a) => (
                <Button
                  key={a.signal}
                  disabled={busy}
                  onClick={() => onSignal({ type: a.signal })}
                  title={`新增${a.label}`}
                >
                  {a.icon} {a.label}
                </Button>
              ))}
            </Row>
          </Section>
        ) : null}

        {/* ── 图层页：**两级**清单（图层 ▸ 元素）。────────────────────────
             结构是「画布 → 图层 → 元素」（见 `vocabulary.ts` 文件头）：`doc.layers` 是**图层**，
             元素在 `Layer.elements` 里。倒序 = 最上层在顶部。
             ⚠️ 组里的元素（组内元素）这一版还不在清单里 —— 那要递归展开，属第二步。 */}
        {tool === 'layers' ? (
          <Section title="图层" icon={<IconLayers />} count={layout.doc.layers.length} collapsible={false}>
            {/* ⭐ 新建图层：追加到最上层并选中它。
                ⚠️ 这建的是**图层**（画布的孩子）；"新增元素"在各自的工具页里（进第一个图层）。 */}
            <Row>
              <Button disabled={busy} title="新建一个空图层（追加到最上层）" onClick={() => onSignal({ type: 'new-layer' })}>
                ＋ 新建图层
              </Button>
            </Row>
            <div className="ui-layer-list">
              {[...layout.doc.layers].reverse().map((L) => (
                <div key={L.id} className={`ui-layer-block${L.id === currentLayerId ? ' is-current' : ''}`}>
                  <ListItem active={selectedLayer === L.id} onClick={() => onSelectLayer(L.id)}>
                    <span className="layer-name layer-name-layer">图层 · {L.id}</span>
                    <span className="ui-layer-actions">
                      {/* ⭐ **显示 / 锁定 就摆在这一行**（像 PS 的图层行），不藏在属性页里 */}
                      {layerAction(
                        L.visible === false ? '显示这个图层' : '隐藏这个图层',
                        L.visible === false ? <IconEyeOff /> : <IconEye />,
                        () => onLayerPatch(L.id, 'visible', L.visible === false),
                      )}
                      {layerAction(L.locked ? '解锁' : '锁定（锁住的图层里元素不能改）', L.locked ? <IconLock /> : <IconUnlock />, () =>
                        onLayerPatch(L.id, 'locked', !L.locked),
                      )}
                      {layerAction('上移一层', <IconUp />, () => onSignal({ type: 'up', id: L.id }))}
                      {layerAction('下移一层', <IconDown />, () => onSignal({ type: 'down', id: L.id }))}
                      {layerAction('删除', <IconTrash />, () => onSignal({ type: 'remove', id: L.id }))}
                    </span>
                  </ListItem>
                  {/* ⭐ **组内元素递归展开**：组里还能是组，一层层摊开。
                      缩进按深度算（`paddingLeft`），不新增 CSS 类。
                      ⚠️ 只在面板里展开 —— 画布上"点空白选中某个组"仍只认直接待在图层里的组
                         （内层组靠点它的成员来选，走 `outermostGroupOf`）。 */}
                  {elementRows(L.elements, 1)}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* ── 这一页的字段（页内小节不折叠 —— 页本身就是"一次只看一类"）── */}
        {tool !== 'layers' ? (
          // ⭐ 选中的是**图层** ⇒ 显示"这张面"自己的属性（底色 / 旋转 / 不透明度）。
          //    图层的字段表在 `inspector.fieldsForLayer()`，控件与元素**共用** `FieldControl`。
          layer ? (
            <Section title="图层" icon={<IconLayers />} count={layerFields.length} collapsible={false}>
              <FieldGrid>
                {layerFields.map((f) => (
                  <FieldRow
                    key={f.path}
                    label={f.label}
                    className={`${isWideKind(f.kind) ? 'wide' : ''}${isCheckKind(f.kind) ? ' check' : ''}`.trim()}
                  >
                    <FieldControl
                      kind={f.kind}
                      value={f.get(layer)}
                      disabled={busy}
                      onCommit={(v) => onLayerPatch(layer.id, f.path, v)}
                    />
                  </FieldRow>
                ))}
              </FieldGrid>
            </Section>
          ) : node ? (
            shown.length ? (
              groups.map((g) => (
                <Section key={g.title} title={g.title} icon={GROUP_ICON[g.title]} count={g.fields.length} collapsible={false}>
                  <FieldGrid>
                    {g.fields.map((f) => (
                      <FieldRow
                        key={f.path}
                        label={f.label}
                        className={`${isWideKind(f.kind) ? 'wide' : ''}${isCheckKind(f.kind) ? ' check' : ''}`.trim()}
                      >
                        <FieldControl kind={f.kind} value={valueOf(f)} disabled={busy} onCommit={(v) => commit(f, v)} />
                      </FieldRow>
                    ))}
                  </FieldGrid>
                </Section>
              ))
            ) : (
              <Hint>
                「{toolDef?.label}」这一页里没有这个元素的字段 —— {toolDef?.hint}
              </Hint>
            )
          ) : (
            <Hint>点画布或「图层」页，选中一个元素</Hint>
          )
        ) : null}
      </PanelBody>
    </Panel>
  );
}
