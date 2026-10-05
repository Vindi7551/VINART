/**
 * Vinart 编辑工作台 —— 注入 final.linked.html 的浏览器脚本
 *
 * 布局(与用户对齐):左侧编辑画布(缩放到整图可见),右侧参数面板(可收起)。
 * spec/appearance 是持久层,这里是编辑视图——改动进内存数据对象,
 * 「导出」下载完整 JSON,覆盖版式目录同名文件后重跑 final 确认。
 *
 * ⚠️ 坐标换算:画布经 transform:scale(SCALE) 适配视区,所有鼠标 delta
 * 都要除以 SCALE 才是 CSS 像素;overlay 用「画布原点 + CSS 坐标 × SCALE」定位。
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('__vinart-data');
  if (!dataEl) return;
  var DATA = JSON.parse(dataEl.textContent);
  var spec = DATA.spec;
  var appearance = DATA.appearance;
  if (!appearance.layers) appearance.layers = {};

  var canvas = document.querySelector('.canvas');
  if (!canvas) return;
  var CW = spec.canvas.width;
  var CH = spec.canvas.height;

  var selected = null;
  var selId = null;
  var drag = null; // { x, y, ox, oy } —— 移动(视觉坐标)
  var rsz = null; // { dir, x, y, l, t, w, h } —— 缩放(起始几何,CSS px)
  var rot = null; // { cx, cy, a0, r0 } —— 旋转(视觉中心/起始鼠标角/起始角度)
  var SCALE = 1;
  var editing = null; // 就地编辑态 { el, id }

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

  // ══════════════════════════════════════════════
  // 工作台外壳:顶栏 + [画布区 | 面板]
  // ══════════════════════════════════════════════

  var shell = document.createElement('div');
  shell.style.cssText = 'position:fixed;inset:0;z-index:2147483640;display:flex;flex-direction:column;background:#12161d';

  var bar = document.createElement('div');
  bar.style.cssText =
    'flex:none;height:36px;display:flex;gap:10px;align-items:center;padding:0 12px;' +
    'background:#1e2430;color:#fff;font:13px/34px system-ui';
  bar.innerHTML =
    '<b>Vinart 编辑</b>' +
    '<span style="opacity:.85">点击选中 · 拖拽移动 · 拖角改大小(Shift 等比) · 拖顶钮旋转 · 双击改字 · Esc 取消</span>' +
    '<button id="ve-exp-spec" style="cursor:pointer">导出 design-sketch.json</button>' +
    '<button id="ve-exp-app" style="cursor:pointer">导出 design-appearance.json</button>' +
    '<button id="ve-toggle" style="cursor:pointer;margin-left:auto">收起面板 »</button>' +
    '<span style="opacity:.7">' + CW + '×' + CH + '</span>';

  var row = document.createElement('div');
  row.style.cssText = 'flex:1;min-height:0;display:flex;align-items:stretch';

  var stage = document.createElement('div');
  stage.style.cssText =
    'flex:1;min-width:0;position:relative;overflow:hidden;display:flex;' +
    'align-items:center;justify-content:center;background:#262c38';

  var panel = document.createElement('div');
  panel.style.cssText =
    'flex:none;width:320px;overflow:auto;background:#fff;color:#111;' +
    'font:13px/1.6 system-ui;padding:12px 14px;border-left:2px solid #1e2430';

  row.appendChild(stage);
  row.appendChild(panel);
  shell.appendChild(bar);
  shell.appendChild(row);
  document.body.appendChild(shell);

  // 画布搬进舞台;wrapper 承担缩放后的占位尺寸(transform 不改布局)
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;flex:none;box-shadow:0 4px 24px rgba(0,0,0,.5)';
  canvas.parentNode.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  stage.appendChild(wrap);

  document.body.style.overflow = 'hidden';
  document.body.style.margin = '0';

  function fit() {
    var pad = 48;
    var availW = stage.clientWidth - pad;
    var availH = stage.clientHeight - pad;
    SCALE = Math.min(availW / CW, availH / CH, 1);
    if (!isFinite(SCALE) || SCALE <= 0) SCALE = 1;
    wrap.style.width = CW * SCALE + 'px';
    wrap.style.height = CH * SCALE + 'px';
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = 'scale(' + SCALE + ')';
    syncOverlay();
  }

  var panelOpen = true;
  function setPanel(open) {
    panelOpen = open;
    panel.style.display = open ? 'block' : 'none';
    document.getElementById('ve-toggle').textContent = open ? '收起面板 »' : '« 展开面板';
    fit();
  }

  // ══════════════════════════════════════════════
  // 手柄 overlay(视口级;跟随画布缩放后的视觉几何)
  // ══════════════════════════════════════════════

  var ov = document.createElement('div');
  ov.style.cssText =
    'position:fixed;display:none;z-index:2147483645;pointer-events:none;' +
    'border:1px dashed #ff5722';
  var HANDLES = ['nw', 'ne', 'sw', 'se'];
  var CURSOR = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' };
  HANDLES.forEach(function (dir) {
    var h = document.createElement('div');
    h.setAttribute('data-ve-handle', dir);
    h.style.cssText =
      'position:absolute;width:12px;height:12px;background:#fff;border:2px solid #ff5722;' +
      'pointer-events:auto;cursor:' + CURSOR[dir] + ';border-radius:2px';
    h.style[dir.charAt(0) === 'n' ? 'top' : 'bottom'] = '-7px';
    h.style[dir.charAt(1) === 'w' ? 'left' : 'right'] = '-7px';
    ov.appendChild(h);
  });
  var rotLine = document.createElement('div');
  rotLine.style.cssText =
    'position:absolute;top:-26px;left:50%;width:0;height:26px;border-left:1px solid #ff5722';
  ov.appendChild(rotLine);
  var rotBtn = document.createElement('div');
  rotBtn.setAttribute('data-ve-rot', '1');
  rotBtn.title = '拖动旋转';
  rotBtn.style.cssText =
    'position:absolute;top:-40px;left:50%;margin-left:-7px;width:14px;height:14px;' +
    'background:#fff;border:2px solid #ff5722;border-radius:50%;pointer-events:auto;cursor:grab';
  ov.appendChild(rotBtn);
  document.body.appendChild(ov);

  // 画布在视口中的原点(缩放后内容左上角)
  function canvasOrigin() {
    var r = canvas.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  // overlay 用「画布原点 + CSS 几何 × SCALE」定位——不用包围盒:
  // 旋转过的元素包围盒会随角度漂移;复制 rotate 让手柄跟着元素转
  function syncOverlay() {
    if (!selected) { ov.style.display = 'none'; return; }
    var l = parseFloat(selected.style.left) || 0;
    var t = parseFloat(selected.style.top) || 0;
    var w = parseFloat(selected.style.width) || 0;
    var h = parseFloat(selected.style.height) || 0;
    var o = canvasOrigin();
    ov.style.display = 'block';
    ov.style.left = o.x + l * SCALE + 'px';
    ov.style.top = o.y + t * SCALE + 'px';
    ov.style.width = w * SCALE + 'px';
    ov.style.height = h * SCALE + 'px';
    var m = /rotate\(([-\d.]+)deg\)/.exec(selected.style.transform || '');
    ov.style.transform = m ? 'rotate(' + m[1] + 'deg)' : 'none';
    ov.style.transformOrigin = 'center';
  }

  // ══════════════════════════════════════════════
  // 移动 / 缩放 / 旋转
  // ══════════════════════════════════════════════

  function syncRectToData(l2, t2, w2, h2) {
    var ly = layerById(selId);
    if (!ly) return;
    ly.rect = {
      x: +(l2 / CW).toFixed(4),
      y: +(t2 / CH).toFixed(4),
      w: +(w2 / CW).toFixed(4),
      h: +(h2 / CH).toFixed(4),
    };
    var ix = document.getElementById('ve-x'), iy = document.getElementById('ve-y');
    var iw = document.getElementById('ve-wd'), ih = document.getElementById('ve-ht');
    if (ix) ix.value = ly.rect.x;
    if (iy) iy.value = ly.rect.y;
    if (iw) iw.value = ly.rect.w;
    if (ih) ih.value = ly.rect.h;
  }

  function applyMove(e) {
    var nx = drag.ox + (e.clientX - drag.x) / SCALE;
    var ny = drag.oy + (e.clientY - drag.y) / SCALE;
    selected.style.left = nx + 'px';
    selected.style.top = ny + 'px';
    syncOverlay();
    var l = layerById(selId);
    if (l) {
      l.rect.x = +(nx / CW).toFixed(4);
      l.rect.y = +(ny / CH).toFixed(4);
      var ix = document.getElementById('ve-x'), iy = document.getElementById('ve-y');
      if (ix) ix.value = l.rect.x;
      if (iy) iy.value = l.rect.y;
    }
  }

  function applyResize(e) {
    var dx = (e.clientX - rsz.x) / SCALE;
    var dy = (e.clientY - rsz.y) / SCALE;
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
    syncRectToData(l, t, w, hh);
  }

  function startResize(dir, e) {
    rsz = {
      dir: dir,
      x: e.clientX,
      y: e.clientY,
      l: parseFloat(selected.style.left) || 0,
      t: parseFloat(selected.style.top) || 0,
      w: selected.offsetWidth,
      h: selected.offsetHeight,
    };
    e.preventDefault();
    e.stopPropagation();
  }

  function startRotate(e) {
    var o = canvasOrigin();
    var l = parseFloat(selected.style.left) || 0;
    var t = parseFloat(selected.style.top) || 0;
    var w = parseFloat(selected.style.width) || 0;
    var hh = parseFloat(selected.style.height) || 0;
    var cx = o.x + (l + w / 2) * SCALE;
    var cy = o.y + (t + hh / 2) * SCALE;
    var ly = layerById(selId);
    rot = {
      cx: cx,
      cy: cy,
      a0: (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI,
      r0: (ly && ly.transform && ly.transform.rotate) || 0,
    };
    e.preventDefault();
    e.stopPropagation();
  }

  function applyRotate(e) {
    var a = ((Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx) * 180) / Math.PI) - rot.a0 + rot.r0;
    a = Math.round(a * 10) / 10;
    selected.style.transform = 'rotate(' + a + 'deg)';
    syncOverlay();
    var l = layerById(selId);
    if (l) {
      l.transform = l.transform || {};
      l.transform.rotate = a;
    }
  }

  window.addEventListener('mousemove', function (e) {
    if (rot && selected) { applyRotate(e); return; }
    if (rsz && selected) { applyResize(e); return; }
    if (drag && selected) applyMove(e);
  });
  window.addEventListener('mouseup', function () { drag = null; rsz = null; rot = null; });
  window.addEventListener('resize', fit);

  // 手柄/旋转柄/元素的事件分发(手柄优先;就地编辑时不启动移动)
  window.addEventListener(
    'mousedown',
    function (e) {
      if (editing) return;
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-ve-rot') && selected) { startRotate(e); return; }
      var handle = t && t.getAttribute && t.getAttribute('data-ve-handle');
      if (handle && selected) { startResize(handle, e); return; }
      if (!selected || !selected.contains(t)) return;
      drag = { x: e.clientX, y: e.clientY, ox: parseFloat(selected.style.left) || 0, oy: parseFloat(selected.style.top) || 0 };
      e.preventDefault();
    },
    true,
  );

  // ══════════════════════════════════════════════
  // 面板:图层清单(无选中)/ 属性(选中)
  // ══════════════════════════════════════════════

  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  document.getElementById('ve-exp-spec').onclick = function () { download('design-sketch.json', spec); };
  document.getElementById('ve-exp-app').onclick = function () { download('design-appearance.json', appearance); };
  document.getElementById('ve-toggle').onclick = function () { setPanel(!panelOpen); };

  function renderList() {
    panel.style.display = 'block';
    var rows = spec.layers
      .map(function (l) {
        return (
          '<div class="ve-item" data-ve-id="' + esc(l.id) + '" style="padding:5px 8px;cursor:pointer;border-radius:4px">' +
          '<b>' + esc(l.id) + '</b> <span style="color:#888">' + l.type + '</span></div>'
        );
      })
      .join('');
    panel.innerHTML =
      '<h3 style="margin:0 0 8px">图层(' + spec.layers.length + ')</h3>' +
      '<div style="margin:-4px -8px">' + rows + '</div>' +
      '<p style="color:#888;font-size:12px">点击图层选中;或直接在左侧图上点选。<br>导出 JSON 后覆盖版式目录同名文件,再重跑 final。</p>';
    Array.prototype.forEach.call(panel.querySelectorAll('.ve-item'), function (item) {
      item.addEventListener('mouseenter', function () { item.style.background = '#eef3ff'; });
      item.addEventListener('mouseleave', function () { item.style.background = ''; });
      item.addEventListener('click', function () {
        var el = canvas.querySelector('[data-layer="' + item.getAttribute('data-ve-id') + '"]');
        if (el) select(el);
      });
    });
  }

  function toHex(v) {
    if (typeof v !== 'string') return '#888888';
    var m = /^#([0-9a-fA-F]{6})$/.exec(v.trim());
    if (m) return '#' + m[1];
    var pal = paletteTable();
    var resolved = pal[v.trim()];
    return resolved && /^#[0-9a-fA-F]{6}$/.test(resolved) ? resolved : '#888888';
  }

  function paletteTable() {
    return typeof appearance.palette === 'object' && appearance.palette ? appearance.palette : {};
  }

  function parseColor(v, pal) {
    if (typeof v !== 'string') return null;
    v = v.trim();
    var m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v);
    if (m)
      return {
        r: parseInt(m[1].slice(0, 2), 16),
        g: parseInt(m[1].slice(2, 4), 16),
        b: parseInt(m[1].slice(4, 6), 16),
      };
    m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    if (pal[v]) return parseColor(pal[v], pal);
    return null;
  }

  function withAlpha(v, a, pal) {
    var c = parseColor(v, pal);
    if (!c) return null;
    var h2 = function (n) {
      var s = Math.round(n).toString(16);
      return s.length < 2 ? '0' + s : s;
    };
    return '#' + h2(c.r) + h2(c.g) + h2(c.b) + h2(a * 255);
  }

  function alphaOf(v, pal) {
    if (typeof v !== 'string') return 1;
    var m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v.trim());
    if (m && m[2]) return parseInt(m[2], 16) / 255;
    var r = /^rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(v.trim());
    if (r) return +r[1];
    if (pal[v]) return alphaOf(pal[v], pal);
    return 1;
  }

  function renderPanel() {
    var l = layerById(selId);
    if (!l) { renderList(); return; }
    var al = appLayer(selId);
    var isText = l.type === 'text';
    var isShape = l.type === 'shape';
    var textVal = '';
    if (isText) textVal = Array.isArray(l.text) ? l.text.join('\n') : String(l.text);

    var h =
      '<div style="margin:-4px -6px 6px"><span id="ve-back" style="cursor:pointer;color:#1b6fd1">« 图层清单</span></div>' +
      '<h3 style="margin:0 0 8px">' + esc(selId) + ' <small style="color:#888">(' + l.type + ')</small></h3>';

    if (isText) {
      h +=
        '<label>文字(双击图上也可就地改)<br>' +
        '<textarea id="ve-text" rows="2" style="width:96%">' + esc(textVal) + '</textarea></label><br>' +
        'fontScale <input id="ve-fs" type="number" step="0.005" value="' + (l.fontScale != null ? l.fontScale : 0.03) + '" style="width:78px"> ' +
        'weight <input id="ve-w" type="number" step="100" min="100" max="900" value="' + (l.weight != null ? l.weight : 400) + '" style="width:64px"> ' +
        'curve <input id="ve-curve" type="number" step="0.1" min="0" max="1" value="' + (l.curve != null ? l.curve : 0) + '" style="width:56px"><br>' +
        '<small style="color:#888">curve 改动保存后重渲生效</small><br>';
    }

    h +=
      'x <input id="ve-x" type="number" step="0.005" value="' + l.rect.x + '" style="width:64px"> ' +
      'y <input id="ve-y" type="number" step="0.005" value="' + l.rect.y + '" style="width:64px"><br>' +
      'w <input id="ve-wd" type="number" step="0.005" value="' + l.rect.w + '" style="width:64px"> ' +
      'h <input id="ve-ht" type="number" step="0.005" value="' + l.rect.h + '" style="width:64px"><br>' +
      '<label>' + (isShape ? 'fill' : 'color') + ' ' +
      '<input id="ve-color" type="color" value="' + toHex(isShape ? al.fill : al.color) + '" style="width:52px;height:24px;vertical-align:middle"> ' +
      '<input id="ve-colortxt" value="' + esc(isShape ? al.fill || '' : al.color || '') + '" placeholder="角色名或#hex" style="width:120px"></label><br>' +
      '颜色透明度 <input id="ve-alpha" type="range" min="0" max="100" value="' + Math.round(alphaOf(isShape ? al.fill : al.color, paletteTable()) * 100) + '" style="width:130px;vertical-align:middle"> <span id="ve-alpha-v"></span><br>' +
      '图层透明度 <input id="ve-lo" type="range" min="0" max="100" value="' + Math.round((al.opacity != null ? al.opacity : 1) * 100) + '" style="width:130px;vertical-align:middle"> <span id="ve-lo-v"></span><br>' +
      '<small style="color:#888">颜色透明度只淡色值;图层透明度整层淡出(含描边)。<br>导出 JSON 覆盖版式目录同名文件 → 重跑 final。</small>';

    panel.innerHTML = h;
    bindPanel(l, al, isText, isShape);
  }

  function bindPanel(l, al, isText, isShape) {
    var el = selected;
    function bind(id, fn) {
      var node = document.getElementById(id);
      if (node) node.addEventListener('change', function () { fn(node.value); });
    }
    var back = document.getElementById('ve-back');
    if (back) back.addEventListener('click', function () { renderList(); });

    if (isText) {
      bind('ve-text', function (v) {
        l.text = v.indexOf('\n') >= 0 ? v.split('\n') : v;
        var fitEl = el.querySelector('.btfit');
        if (fitEl) {
          fitEl.innerHTML = v
            .split('\n')
            .map(function (s) { return esc(s); })
            .join('<br>');
        }
      });
      bind('ve-fs', function (v) {
        l.fontScale = +v;
        var fitEl = el.querySelector('.btfit');
        if (fitEl) fitEl.style.fontSize = Math.round(+v * CW) + 'px';
      });
      bind('ve-w', function (v) {
        l.weight = +v;
        var fitEl = el.querySelector('.btfit');
        if (fitEl) fitEl.style.fontWeight = v;
      });
      bind('ve-curve', function (v) { l.curve = +v || 0; });
    }

    function applyRect() {
      el.style.left = l.rect.x * CW + 'px';
      el.style.top = l.rect.y * CH + 'px';
      el.style.width = l.rect.w * CW + 'px';
      el.style.height = l.rect.h * CH + 'px';
      syncOverlay();
    }
    bind('ve-x', function (v) { l.rect.x = +v; applyRect(); });
    bind('ve-y', function (v) { l.rect.y = +v; applyRect(); });
    bind('ve-wd', function (v) { l.rect.w = +v; applyRect(); });
    bind('ve-ht', function (v) { l.rect.h = +v; applyRect(); });

    var colorKey = isShape ? 'fill' : 'color';
    var palTable = paletteTable();

    function applyColor(v) {
      al[colorKey] = v;
      if (isShape) { el.style.background = v; }
      else {
        var fitEl = el.querySelector('.btfit');
        if (fitEl) fitEl.style.color = v;
      }
      var sw = document.getElementById('ve-color');
      if (sw) sw.value = toHex(v);
      var av = document.getElementById('ve-alpha');
      if (av) av.value = Math.round(alphaOf(v, palTable) * 100);
      var avt = document.getElementById('ve-alpha-v');
      if (avt) avt.textContent = Math.round(alphaOf(v, palTable) * 100) + '%';
    }

    bind('ve-color', applyColor);
    bind('ve-colortxt', function (v) {
      if (!v.trim()) { delete al[colorKey]; return; }
      applyColor(v);
    });
    bind('ve-alpha', function (v) {
      var next = withAlpha(al[colorKey] || '#FFFFFF', +v / 100, palTable);
      if (next) applyColor(next);
      var avt = document.getElementById('ve-alpha-v');
      if (avt) avt.textContent = v + '%';
    });
    var avt0 = document.getElementById('ve-alpha-v');
    if (avt0) avt0.textContent = Math.round(alphaOf(al[colorKey], palTable) * 100) + '%';

    function applyLayerOpacity(v) {
      var o = +v / 100;
      if (o >= 1) delete al.opacity;
      else al.opacity = o;
      el.style.opacity = o;
      var lov = document.getElementById('ve-lo-v');
      if (lov) lov.textContent = v + '%';
    }
    bind('ve-lo', applyLayerOpacity);
    var lov0 = document.getElementById('ve-lo-v');
    if (lov0) lov0.textContent = Math.round((al.opacity != null ? al.opacity : 1) * 100) + '%';
  }

  // ══════════════════════════════════════════════
  // 选中 / 深链 / 就地编辑
  // ══════════════════════════════════════════════

  function select(el) {
    if (selected) selected.style.outline = '';
    selected = el;
    selId = el.getAttribute('data-layer');
    el.style.outline = '2px solid #ff5722';
    renderPanel();
    syncOverlay();
  }

  function deselect() {
    if (selected) selected.style.outline = '';
    selected = null;
    selId = null;
    ov.style.display = 'none';
    renderList();
  }

  canvas.addEventListener(
    'click',
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-layer]') : null;
      if (!el) return;
      select(el);
    },
    true,
  );

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (editing) endInlineEdit(false);
      else deselect();
    }
  });

  // ── 文字就地编辑(双击进入;弧形节点走面板)──
  function endInlineEdit(save) {
    if (!editing) return;
    var fitEl = editing.el.querySelector('.btfit');
    if (fitEl) {
      var l = layerById(editing.id);
      if (save) {
        var lines = fitEl.innerText.replace(/\n$/, '').split('\n');
        if (l) l.text = lines.length === 1 ? lines[0] : lines;
        fitEl.innerHTML = lines
          .map(function (s) { return esc(s); })
          .join('<br>');
      } else {
        var t0 = l ? (Array.isArray(l.text) ? l.text.join('\n') : String(l.text)) : '';
        fitEl.innerHTML = t0
          .split('\n')
          .map(function (s) { return esc(s); })
          .join('<br>');
      }
      fitEl.contentEditable = 'false';
      fitEl.style.outline = '';
      fitEl.style.cursor = '';
    }
    editing = null;
  }

  canvas.addEventListener(
    'dblclick',
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-layer]') : null;
      if (!el) return;
      var l = layerById(el.getAttribute('data-layer'));
      if (!l || l.type !== 'text') return;
      var fitEl = el.querySelector('.btfit');
      if (!fitEl) return;
      if (l.curve) {
        select(el);
        var ta = document.getElementById('ve-text');
        if (ta) ta.focus();
        return;
      }
      select(el);
      editing = { el: el, id: l.id };
      fitEl.contentEditable = 'true';
      fitEl.style.outline = '1px dashed #1b6fd1';
      fitEl.style.cursor = 'text';
      fitEl.focus();
      var range = document.createRange();
      range.selectNodeContents(fitEl);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      e.preventDefault();
    },
    true,
  );

  document.addEventListener('focusout', function (e) {
    if (!editing) return;
    var fitEl = editing.el.querySelector('.btfit');
    if (!fitEl || !e.target || !fitEl.contains(e.target)) return;
    setTimeout(function () {
      if (editing && !fitEl.contains(document.activeElement)) endInlineEdit(true);
    }, 0);
  });

  // ══════════════════════════════════════════════
  // 启动:布局 → 初始面板 → 深链
  // ══════════════════════════════════════════════

  fit();
  renderList();

  // ?sel=<id> 深链:打开即自动选中(调试与分享锚点)——
  // ⚠️ 必须放在所有 UI 创建之后
  var want = new URLSearchParams(location.search).get('sel');
  if (want) {
    var pre = canvas.querySelector('[data-layer="' + want + '"]');
    if (pre) select(pre);
  }
})();
