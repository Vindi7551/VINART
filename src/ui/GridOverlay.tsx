import { computeGrid, type GridConfig } from './grid';

/**
 * 网格覆盖层：挂在 `.canvas-wrapper` 里，坐标就是画布 local px。
 * 因为 wrapper 自己带 `scale(zoom)`，这里不需要任何 zoom/pan 换算。
 *
 * 视觉：
 * - 列 = 竖线（列边界）
 * - 行 = 细虚线
 * - margin > 0 时补一圈版心虚线
 *
 * ⚠️ 只画线，不填色带：颜色只作用于参考线，不会改画布底色。
 * ⚠️ `pointer-events:none` 由 CSS 保证，绝不能抢选中/拖拽。
 */
export function GridOverlay({
  width,
  height,
  config,
}: {
  width: number;
  height: number;
  config: GridConfig;
}) {
  if (!config.enabled) return null;
  const grid = computeGrid(width, height, config);
  if (!grid.columns.length && !grid.rows.length) return null;

  const { color, opacity } = config;
  const rowLines: number[] = [];
  for (const r of grid.rows) rowLines.push(r.y);
  if (grid.rows.length) {
    const last = grid.rows[grid.rows.length - 1]!;
    rowLines.push(last.y + last.h);
  }

  // 列只画边界线；gutter=0 时相邻列共享一条线，去重避免叠色
  const colEdges: number[] = [];
  for (const c of grid.columns) {
    if (!colEdges.includes(c.x)) colEdges.push(c.x);
    if (!colEdges.includes(c.x + c.w)) colEdges.push(c.x + c.w);
  }
  colEdges.sort((a, b) => a - b);

  const x1 = grid.marginBox?.x ?? 0;
  const x2 = x1 + (grid.marginBox?.w ?? width);
  const y1 = grid.marginBox?.y ?? 0;
  const y2 = y1 + (grid.marginBox?.h ?? height);

  return (
    <svg
      className="grid-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <g opacity={opacity}>
        {grid.marginBox ? (
          <rect
            x={x1}
            y={y1}
            width={grid.marginBox.w}
            height={grid.marginBox.h}
            fill="none"
            stroke={color}
            strokeOpacity="0.55"
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {colEdges.map((x, i) => (
          <line
            key={`c${i}`}
            x1={x}
            y1={y1}
            x2={x}
            y2={y2}
            stroke={color}
            strokeOpacity="0.55"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {rowLines.map((y, i) => (
          <line
            key={`r${i}`}
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke={color}
            strokeOpacity="0.55"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
