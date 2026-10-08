/**
 * 注入到 iframe 内的交互脚本。
 *
 * 只让「有意义的原子元素」可点击选中：
 * - data-image-slot 槽位
 * - 标题 / 副标题
 * - 段落文本
 * - 按钮 / CTA
 * - 价格标签
 */

export function createInteractionScript(): string {
  return `
<script>
(function() {
  'use strict';

  var selectedEl = null;
  var overlay = null;

  // ── 创建高亮层 ──
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = '__vinart_hl__';
    overlay.style.cssText =
      'position:absolute;pointer-events:none;z-index:9999;' +
      'outline:2px solid #6366f1;outline-offset:0px;' +
      'background:rgba(99,102,241,0.06);display:none;';
    document.body.appendChild(overlay);
  }

  function moveOverlay(el) {
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left   = (r.left + window.scrollX) + 'px';
    overlay.style.top    = (r.top  + window.scrollY) + 'px';
    overlay.style.width  = r.width  + 'px';
    overlay.style.height = r.height + 'px';
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  // ── 元素信息 ──
  function tell(type, el) {
    var payload = { type: type, element: null };
    if (el) {
      var slot = el.getAttribute('data-image-slot') || '';
      var vinartId = el.getAttribute('data-vinart-id') || '';
      var vinartType = el.getAttribute('data-vinart-type') || '';
      payload.element = {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        text: (el.textContent || '').trim().slice(0, 50),
        slotId: slot,
        vinartId: vinartId,
        vinartType: vinartType,
      };
    }
    window.parent.postMessage(payload, '*');
  }

  // ── 判断是否为「有意义的原子元素」──
  function isAtomic(el) {
    if (!el.hasAttribute) return false;
    // 标记了 data-vinart-type 的都是原子元素
    if (el.hasAttribute('data-vinart-type')) return true;
    var tag = el.tagName;
    // 图片槽位
    if (el.hasAttribute('data-image-slot')) return true;
    // 标题
    if (/^H[1-6]$/.test(tag)) return true;
    // 段落
    if (tag === 'P') return true;
    // 按钮
    if (tag === 'BUTTON' || tag === 'A') return true;
    // 小文本片段：span / label / strong / em，且内容较短（非大容器伪装的）
    if (/^(SPAN|LABEL|STRONG|EM|SMALL)$/.test(tag)) {
      var t = (el.textContent || '').trim();
      if (t.length > 0 && t.length < 200) return true;
    }
    return false;
  }

  // ── 从点击目标向上找最近的原子元素 ──
  function findAtomic(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      if (isAtomic(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── 全局点击委托 ──
  document.addEventListener('click', function(e) {
    if (e.target === overlay) return;

    var atomic = findAtomic(e.target);
    if (!atomic) {
      // 点击了非原子元素区域
      if (selectedEl) {
        selectedEl = null;
        hideOverlay();
        tell('vinart:deselect');
      }
      return;
    }

    // 已经是选中态 → 取消
    if (selectedEl === atomic) {
      selectedEl = null;
      hideOverlay();
      tell('vinart:deselect');
      return;
    }

    // 选中新元素
    selectedEl = atomic;
    moveOverlay(atomic);
    tell('vinart:select', atomic);
  });

  // ── 按标识查找 DOM 元素 ──
  function findByVinartId(id) {
    return document.querySelector('[data-vinart-id="' + id + '"]');
  }

  function findBySlotId(id) {
    return document.querySelector('[data-image-slot="' + id + '"]');
  }

  function findByTagText(tag, text) {
    var list = document.querySelectorAll(tag);
    for (var i = 0; i < list.length; i++) {
      if (list[i].textContent.trim().slice(0, 30) === text) return list[i];
    }
    return null;
  }

  // ── 父窗口指令 ──
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || msg.source !== 'vinart') return;
    switch (msg.action) {
      case 'deselect':
        if (selectedEl) selectedEl = null;
        hideOverlay();
        break;
      case 'select-by-id':
        // 父窗口要求选中某个元素，优先用 data-vinart-id 精确查找
        var el = null;
        if (msg.vinartId) el = findByVinartId(msg.vinartId);
        if (!el && msg.slotId) el = findBySlotId(msg.slotId);
        if (!el && msg.tag && msg.text) el = findByTagText(msg.tag, msg.text);
        if (el && selectedEl !== el) {
          selectedEl = el;
          moveOverlay(el);
          // 不发送 select 消息——避免父窗口收到后再次 toggle
        }
        break;
      case 'modify-style':
        if (selectedEl && msg.property) {
          selectedEl.style[msg.property] = msg.value;
          moveOverlay(selectedEl);
        }
        break;
      case 'modify-text':
        if (selectedEl && msg.text !== undefined) {
          selectedEl.textContent = msg.text;
          moveOverlay(selectedEl);
        }
        break;
    }
  });

  // ── 空白区域取消选中 ──
  document.addEventListener('click', function(e) {
    if (e.target === document.body || e.target === document.documentElement) {
      selectedEl = null;
      hideOverlay();
      tell('vinart:deselect');
    }
  });

  // ── 启动 ──
  function init() {
    ensureOverlay();
    // 延迟上报真实画布尺寸，确保 CSS 布局完成
    setTimeout(reportCanvasSize, 100);
  }

  // ── 向父窗口上报真实内容尺寸 ──
  // 遍历 body 子元素，找最大的非脚本/非 overlay 容器
  function reportCanvasSize() {
    var w = 0, h = 0;
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c.tagName === 'SCRIPT') continue;
      if (c.id === '__vinart_hl__') continue;  // 忽略高亮 overlay
      var cw = Math.max(c.scrollWidth || 0, c.offsetWidth || 0);
      var ch = Math.max(c.scrollHeight || 0, c.offsetHeight || 0);
      if (cw > w) w = cw;
      if (ch > h) h = ch;
    }
    if (w > 0 && h > 0) {
      window.parent.postMessage({ type: 'vinart:canvas-size', width: w, height: h }, '*');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>`; 
}
