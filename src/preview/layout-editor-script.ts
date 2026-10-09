/**
 * 版式受控编辑脚本 —— 注入 PreviewPanel 的 iframe,与 React 宿主 postMessage 通信。
 *
 * 能力(早期从一份**独立版**编辑器脚本 `scripts/editor.inject.js` 移植——那份独立版
 * 连同它注入的 final.linked.html 已于 2026-10-09 删除,本文件是唯一的编辑器实现):点选/拖拽移动/四角缩放(Shift 等比)/
 * 顶柄旋转/双击就地改字。与独立版的区别:**没有面板与导出**——参数编辑在 React 侧,
 * 这里只管「图上直接操作」并把数据变更上报。
 *
 * 协议(全部 { source: 'vinart', ... } 信封):
 *   收  ve:viewport  { zoom }            外层画布 zoom 变了,鼠标 delta 换算用
 *   收  ve:select    { id }              React 侧(图层清单)发起选中
 *   收  ve:patch     { id, patch }       React 参数面板改属性,实时应用
 *   收  ve:set-data  { spec, appearance } 外部数据整体替换(重载/撤销用)
 *   发  ve:select    { id }              图上点选 → React 切换面板
 *   发  ve:change    { id, patch }       图上操作产生的数据变更(拖拽结束/就地改字落定)
 *
 * patch 形状:{ rect?, text?, fontScale?, weight?, curve?, color?, fill?, opacity?, rotate? }
 * 数据来源:注入的 __vinart-data(spec + appearance 全量)。
 */

export function createLayoutEditorScript(): string {
  return `
<script>
(function () {
  'use strict';

  var specEl = document.getElementById('__vinart-data');
  if (!specEl) return;
  var spec = JSON.parse(specEl.textContent);
  var appEl = document.getElementById('__vinart-appearance');
  var appearance = appEl ? JSON.parse(appEl.textContent) : {};
  if (!appearance.layers) appearance.layers = {};

  var ZOOM = 1;
  var selected = null;
  var selId = null;
  var drag = null, rsz = null, rot = null;
  var editing = null;

  function post(type, extra) {
    var msg = Object.assign({ source: 'vinart-editor', type: type }, extra || {});
    parent.postMessage(msg, '*');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function layerById(id) {
    for (var i = 0; i < spec.layers.length; i++) if (spec.layers[i].id === id) return spec.layers[i];
    return null;
  }
  function appLayer(id) {
    if (!appearance.layers[id]) appearance.layers[id] = {};
    return appearance.layers[id];
  }

  // ── overlay:选中框 + 四角缩放柄 + 顶中旋转柄 ──
  var ov = document.createElement('div');
  ov.style.cssText = 'position:absolute;display:none;z-index:2147483645;pointer-events:none;border:1px dashed #ff5722';
  ['nw', 'ne', 'sw', 'se'].forEach(function (dir) {
    var h = document.createElement('div');
    h.setAttribute('data-ve-handle', dir);
    h.style.cssText =
      'position:absolute;width:12px;height:12px;background:#fff;border:2px solid #ff5722;' +
      'pointer-events:auto;cursor:' + (dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize') + ';border-radius:2px';
    h.style[dir.charAt(0) === 'n' ? 'top' : 'bottom'] = '-7px';
    h.style[dir.charAt(1) === 'w' ? 'left' : 'right'] = '-7px';
    ov.appendChild(h);
  });
  var rotLine = document.createElement('div');
  rotLine.style.cssText = 'position:absolute;top:-26px;left:50%;width:0;height:26px;border-left:1px solid #ff5722';
  ov.appendChild(rotLine);
  var rotBtn = document.createElement('div');
  rotBtn.setAttribute('data-ve-rot', '1');
  rotBtn.style.cssText =
    'position:absolute;top:-40px;left:50%;margin-left:-7px;width:14px;height:14px;' +
    'background:#fff;border:2px solid #ff5722;border-radius:50%;pointer-events:auto;cursor:grab';
  ov.appendChild(rotBtn);
  document.body.appendChild(ov);

  function syncOverlay() {
    if (!selected) { ov.style.display = 'none'; return; }
    ov.style.display = 'block';
    ov.style.left = selected.style.left;
    ov.style.top = selected.style.top;
    ov.style.width = selected.style.width;
    ov.style.height = selected.style.height;
    var m = /rotate\\(([-\\d.]+)deg\\)/.exec(selected.style.transform || '');
    ov.style.transform = m ? 'rotate(' + m[1] + 'deg)' : 'none';
    ov.style.transformOrigin = 'center';
  }

  // ── 移动/缩放/旋转 ──
  function applyMove(e) {
    var nx = drag.ox + (e.clientX - drag.x) / ZOOM;
    var ny = drag.oy + (e.clientY - drag.y) / ZOOM;
    selected.style.left = nx + 'px';
    selected.style.top = ny + 'px';
    syncOverlay();
    var l = layerById(selId);
    if (l) { l.rect.x = +(nx / spec.canvas.width).toFixed(4); l.rect.y = +(ny / spec.canvas.height).toFixed(4); }
  }

  function applyResize(e) {
    var dx = (e.clientX - rsz.x) / ZOOM;
    var dy = (e.clientY - rsz.y) / ZOOM;
    var d = rsz.dir;
    var l = rsz.l, t = rsz.t, w = rsz.w, hh = rsz.h;
    if (d.indexOf('e') >= 0) w = Math.max(24, rsz.w + dx);
    if (d.indexOf('s') >= 0) hh = Math.max(24, rsz.h + dy);
    if (d.indexOf('w') >= 0) { w = Math.max(24, rsz.w - dx); l = rsz.l + (rsz.w - w); }
    if (d.indexOf('n') >= 0) { hh = Math.max(24, rsz.h - dy); t = rsz.t + (rsz.h - hh); }
    if (e.shiftKey) {
      var ratio = rsz.h / rsz.w;
      if (d.indexOf('e') >= 0 || d.indexOf('w') >= 0) hh = Math.max(24, w * ratio);
      else w = Math.max(24, hh / ratio);
      if (d.indexOf('w') >= 0) l = rsz.l + (rsz.w - w);
      if (d.indexOf('n') >= 0) t = rsz.t + (rsz.h - hh);
    }
    selected.style.left = l + 'px';
    selected.style.top = t + 'px';
    selected.style.width = w + 'px';
    selected.style.height = hh + 'px';
    syncOverlay();
    var ly = layerById(selId);
    if (ly) {
      ly.rect = { x: +(l / spec.canvas.width).toFixed(4), y: +(t / spec.canvas.height).toFixed(4),
                  w: +(w / spec.canvas.width).toFixed(4), h: +(hh / spec.canvas.height).toFixed(4) };
    }
  }

  function applyRotate(e) {
    var r = selected.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var a = ((Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI) - rot.a0 + rot.r0;
    a = Math.round(a * 10) / 10;
    selected.style.transform = 'rotate(' + a + 'deg)';
    syncOverlay();
    var l = layerById(selId);
    if (l) { l.transform = l.transform || {}; l.transform.rotate = a; }
  }

  window.addEventListener('mousemove', function (e) {
    if (rot && selected) { applyRotate(e); return; }
    if (rsz && selected) { applyResize(e); return; }
    if (drag && selected) applyMove(e);
  });
  window.addEventListener('mouseup', function () {
    // 操作落定:把最终几何作为 patch 上报(React 侧合并进持久数据)
    if (drag && selected && selId) {
      var l = layerById(selId);
      if (l) post('ve:change', { id: selId, patch: { rect: Object.assign({}, l.rect) } });
    }
    if (rsz && selected && selId) {
      var l2 = layerById(selId);
      if (l2) post('ve:change', { id: selId, patch: { rect: Object.assign({}, l2.rect) } });
    }
    if (rot && selected && selId) {
      var l3 = layerById(selId);
      if (l3) post('ve:change', { id: selId, patch: { rotate: l3.transform.rotate } });
    }
    drag = null; rsz = null; rot = null;
  });

  window.addEventListener('mousedown', function (e) {
    if (editing) return;
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-ve-rot') && selected) {
      var r = selected.getBoundingClientRect();
      var ly0 = layerById(selId);
      rot = {
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        a0: (Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180) / Math.PI,
        r0: (ly0 && ly0.transform && ly0.transform.rotate) || 0,
      };
      e.preventDefault(); e.stopPropagation();
      return;
    }
    var handle = t && t.getAttribute && t.getAttribute('data-ve-handle');
    if (handle && selected) {
      rsz = { dir: handle, x: e.clientX, y: e.clientY,
              l: parseFloat(selected.style.left) || 0, t: parseFloat(selected.style.top) || 0,
              w: selected.offsetWidth, h: selected.offsetHeight };
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (!selected || !selected.contains(t)) return;
    drag = { x: e.clientX, y: e.clientY, ox: parseFloat(selected.style.left) || 0, oy: parseFloat(selected.style.top) || 0 };
    e.preventDefault();
  }, true);

  // ── 选中/点击上报 ──
  function select(el) {
    if (selected) selected.style.outline = '';
    selected = el;
    selId = el.getAttribute('data-layer');
    el.style.outline = '2px solid #ff5722';
    syncOverlay();
    post('ve:select', { id: selId });
  }
  function deselect() {
    if (selected) selected.style.outline = '';
    selected = null; selId = null;
    ov.style.display = 'none';
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-layer]') : null;
    if (el) select(el);
    // 点在染色词上 → 上报具体词,宿主面板的单行颜色跟随切换
    var wordEl = e.target && e.target.getAttribute ? e.target.getAttribute('data-ve-word') : null;
    if (wordEl && el) post('ve:word', { id: el.getAttribute('data-layer'), word: wordEl });
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !editing) deselect();
  });

  // ── 就地改字(双击;弧形节点不支持)──
  function endInlineEdit(save) {
    if (!editing) return;
    var fitEl = editing.el.querySelector('.btfit');
    if (fitEl) {
      var l = layerById(editing.id);
      if (save) {
        var lines = fitEl.innerText.replace(/\\n$/, '').split('\\n');
        if (l) l.text = lines.length === 1 ? lines[0] : lines;
        fitEl.innerHTML = lines.map(function (s) { return esc(s); }).join('<br>');
        post('ve:change', { id: editing.id, patch: { text: l ? l.text : '' } });
      } else {
        var t0 = l ? (Array.isArray(l.text) ? l.text.join('\\n') : String(l.text)) : '';
        fitEl.innerHTML = t0.split('\\n').map(function (s) { return esc(s); }).join('<br>');
      }
      fitEl.contentEditable = 'false';
      fitEl.style.outline = '';
      fitEl.style.cursor = '';
    }
    editing = null;
  }
  document.addEventListener('dblclick', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-layer]') : null;
    if (!el) return;
    var l = layerById(el.getAttribute('data-layer'));
    if (!l || l.type !== 'text' || l.curve) return;
    var fitEl = el.querySelector('.btfit');
    if (!fitEl) return;
    select(el);
    editing = { el: el, id: l.id };
    fitEl.contentEditable = 'true';
    fitEl.style.outline = '1px dashed #1b6fd1';
    fitEl.style.cursor = 'text';
    fitEl.focus();
    var range = document.createRange();
    range.selectNodeContents(fitEl);
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(range);
    e.preventDefault();
  }, true);
  document.addEventListener('focusout', function (e) {
    if (!editing) return;
    var fitEl = editing.el.querySelector('.btfit');
    if (!fitEl || !e.target || !fitEl.contains(e.target)) return;
    setTimeout(function () {
      if (editing && !fitEl.contains(document.activeElement)) endInlineEdit(true);
    }, 0);
  });

  // ── React → iframe 指令 ──
  function applyPatch(id, patch) {
    var l = layerById(id);
    if (!l) return;
    var el = document.querySelector('[data-layer="' + id + '"]');
    var al = appLayer(id);
    if (patch.rect) { l.rect = patch.rect; if (el) { el.style.left = patch.rect.x * spec.canvas.width + 'px'; el.style.top = patch.rect.y * spec.canvas.height + 'px'; el.style.width = patch.rect.w * spec.canvas.width + 'px'; el.style.height = patch.rect.h * spec.canvas.height + 'px'; } }
    if (patch.text !== undefined) { l.text = patch.text; if (el) { var f = el.querySelector('.btfit'); if (f) f.innerHTML = (Array.isArray(patch.text) ? patch.text : [patch.text]).map(function (s) { return esc(s); }).join('<br>'); } }
    if (patch.fontScale !== undefined) { l.fontScale = patch.fontScale; if (el) { var f2 = el.querySelector('.btfit'); if (f2) f2.style.fontSize = Math.round(patch.fontScale * spec.canvas.width) + 'px'; } }
    if (patch.weight !== undefined) { l.weight = patch.weight; if (el) { var f3 = el.querySelector('.btfit'); if (f3) f3.style.fontWeight = patch.weight; } }
    if (patch.color !== undefined) { al.color = patch.color; if (el) { var f4 = el.querySelector('.btfit'); if (f4) f4.style.color = patch.color; } }
    if (patch.accents !== undefined) { al.accents = patch.accents; if (al.accent) delete al.accent; /* 多组染色重渲生效 */ }
    if (patch.accent !== undefined) { al.accent = patch.accent; /* 旧单组:重渲生效 */ }
    if (patch.accent !== undefined) { al.accent = patch.accent; /* 强调词染色在重渲时生效 */ }
    if (patch.fill !== undefined) { al.fill = patch.fill; if (el) el.style.background = patch.fill; }
    if (patch.opacity !== undefined) { if (patch.opacity >= 1) delete al.opacity; else al.opacity = patch.opacity; if (el) el.style.opacity = patch.opacity; }
    if (patch.rotate !== undefined) { l.transform = l.transform || {}; l.transform.rotate = patch.rotate; if (el) el.style.transform = 'rotate(' + patch.rotate + 'deg)'; }
    if (selId === id) syncOverlay();
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    // 兼容两代宿主信封:source 'vinart-host'(受控协议)/ 'vinart'(旧 action 字段)
    if (!msg || (msg.source !== 'vinart-host' && msg.source !== 'vinart')) return;
    var type = msg.type || msg.action;
    if (type === 've:viewport') { ZOOM = msg.zoom || 1; return; }
    if (msg.type === 've:select') {
      var el = msg.id ? document.querySelector('[data-layer="' + msg.id + '"]') : null;
      if (el) select(el);
      return;
    }
    if (msg.type === 've:patch') { applyPatch(msg.id, msg.patch); return; }
    if (msg.type === 've:set-data') {
      spec = msg.spec; appearance = msg.appearance || {};
      if (!appearance.layers) appearance.layers = {};
      return;
    }
  });

  // 画布尺寸上报(宿主做缩放适配)
  function reportSize() {
    post('ve:canvas-size', { width: spec.canvas.width, height: spec.canvas.height });
  }
  reportSize();

  // 就绪探针:脚本跑到这里 = 全部交互绑定成功。
  // headless 验证与排障:dump-dom 里 grep data-ve-ready
  document.documentElement.setAttribute('data-ve-ready', '1');
})();
</script>
`;
}
