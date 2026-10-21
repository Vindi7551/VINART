import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ChatReference, MentionItem } from './types';

export type { ChatReference, MentionItem };

interface PendingImage {
  id: string;
  file: File;
  url: string;
}

interface ComposerInputProps {
  disabled?: boolean;
  placeholder: string;
  mentions: MentionItem[];
  onSend: (text: string, files?: File[], references?: ChatReference[]) => void;
}

export interface ComposerInputHandle {
  pickFiles: () => void;
  submit: () => void;
}

const IMG_LABEL = (n: number) => `图片${n}`;

/**
 * **contentEditable 输入框**：图片 inline chip + `@` 元素 chip。
 *
 * 关键约定：
 * - chip 是 `contenteditable=false` 的 span，`data-ref-kind` 区分 image / element；
 * - 图片 chip 的 label 是 `图片N`，hover 显示缩略图（CSS 用内联 `--thumb`）；
 * - 元素 chip 显示 `@name`，底层 `data-ref-id` / `data-ref-layout`；
 * - 发送时遍历 childNodes，序列化成 text + files + references；
 * - 非受控：DOM 由浏览器维护，React 只在发送/附件变化时同步。
 */
export const ComposerInput = forwardRef<ComposerInputHandle, ComposerInputProps>(
  function ComposerInput({ disabled = false, placeholder, mentions, onSend }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sendRef = useRef<() => void>(() => {});
    const [images, setImages] = useState<PendingImage[]>([]);
    const imagesRef = useRef(images);
    imagesRef.current = images;
    const [popover, setPopover] = useState<{ query: string } | null>(null);
    const [active, setActive] = useState(0);
    const composing = useRef(false);
    /** 候选按钮引用：键盘上下移动时把当前项滚进视野（列表不再截断，可能有几十项） */
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    useEffect(() => {
      if (!popover) return;
      optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
    }, [active, popover]);

    useImperativeHandle(ref, () => ({
      pickFiles: () => fileInputRef.current?.click(),
      submit: () => sendRef.current(),
    }), []);

    const filtered = (() => {
      const q = popover?.query.trim().toLowerCase() ?? '';
      if (!mentions.length) return [];
      return q
        ? mentions.filter(
            (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
          )
        : mentions;
    })();

    const textBeforeCaret = (): string => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return '';
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return '';
      return (node.textContent ?? '').slice(0, range.startOffset);
    };

    const focusCaret = (node: Node, offset: number) => {
      const sel = window.getSelection();
      if (!sel) return;
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    };

    const makeChip = (kind: 'image' | 'element', text: string, data: Record<string, string>) => {
      const chip = document.createElement('span');
      chip.contentEditable = 'false';
      chip.className = kind === 'image' ? 'ref-chip image-chip' : 'ref-chip mention-chip';
      chip.dataset.refKind = kind;
      chip.textContent = text;
      for (const [k, v] of Object.entries(data)) chip.dataset[k] = v;
      return chip;
    };

    const insertAfterCaret = (chip: HTMLElement) => {
      const sel = window.getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        range.insertNode(chip);
        const space = document.createTextNode(' ');
        chip.after(space);
        focusCaret(space, space.length);
      } else {
        editorRef.current?.appendChild(chip);
        focusCaret(editorRef.current ?? chip, 0);
      }
      editorRef.current?.focus();
    };

    const addImages = (imgs: File[]) => {
      if (!imgs.length) return;
      const next = [...imagesRef.current];
      for (const file of imgs) {
        if (!file.type.startsWith('image/')) continue;
        const n = next.length + 1;
        const img: PendingImage = {
          id: `img_${n}`,
          file,
          url: URL.createObjectURL(file),
        };
        next.push(img);
        const chip = makeChip('image', IMG_LABEL(n), {
          refId: img.id,
          thumb: img.url,
        });
        chip.title = IMG_LABEL(n);
        chip.style.setProperty('--thumb', `url("${img.url}")`);
        insertAfterCaret(chip);
      }
      setImages(next);
    };

    const insertMention = (item: MentionItem) => {
      const sel = window.getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      // 删掉光标前的 "@query"
      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        const node = range.startContainer as Text;
        const before = (node.textContent ?? '').slice(0, range.startOffset);
        const m = /@[^\s@]*$/.exec(before);
        if (m) {
          const start = range.startOffset - m[0].length;
          node.textContent =
            (node.textContent ?? '').slice(0, start) +
            (node.textContent ?? '').slice(range.startOffset);
          focusCaret(node, start);
        }
      }
      const chip = makeChip('element', `@${item.name}`, {
        refId: item.id,
        refLayout: item.layout,
      });
      chip.title = `${item.name} (${item.id})`;
      insertAfterCaret(chip);
      setPopover(null);
    };

    const serialize = (): { text: string; files?: File[]; references?: ChatReference[] } => {
      const editor = editorRef.current;
      const files: File[] = [];
      const references: ChatReference[] = [];
      let text = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent ?? '';
          return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.dataset.refKind === 'image') {
          const id = node.dataset.refId ?? '';
          const img = imagesRef.current.find((x) => x.id === id);
          if (img && !files.includes(img.file)) files.push(img.file);
          text += node.textContent ?? '';
          return;
        }
        if (node.dataset.refKind === 'element') {
          references.push({
            kind: 'element',
            layout: node.dataset.refLayout ?? '',
            id: node.dataset.refId ?? '',
            name: (node.textContent ?? '').replace(/^@/, ''),
          });
          text += node.textContent ?? '';
          return;
        }
        if (node.nodeName === 'BR') {
          text += '\n';
          return;
        }
        node.childNodes.forEach(walk);
      };
      editor?.childNodes.forEach(walk);
      return {
        text: text.trim(),
        ...(files.length ? { files } : {}),
        ...(references.length ? { references } : {}),
      };
    };

    const send = () => {
      if (disabled) return;
      const { text, files, references } = serialize();
      if (!text && !files?.length) return;
      onSend(text, files, references);
      if (editorRef.current) editorRef.current.innerHTML = '';
      for (const img of imagesRef.current) URL.revokeObjectURL(img.url);
      setImages([]);
      setPopover(null);
    };
    sendRef.current = send;

    const refreshPopover = () => {
      if (composing.current) return;
      const before = textBeforeCaret();
      const m = /(^|\s)@([^\s@]*)$/.exec(before);
      if (m) {
        setPopover({ query: m[2] });
        setActive(0);
      } else {
        setPopover(null);
      }
    };

    return (
      <div className="composer-input-wrap">
        <div
          ref={editorRef}
          className="composer-input"
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={refreshPopover}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            refreshPopover();
          }}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData?.items ?? [])
              .filter((it) => it.type.startsWith('image/'))
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f);
            if (imgs.length) {
              e.preventDefault();
              addImages(imgs);
            }
          }}
          onKeyDown={(e) => {
            if (popover && filtered.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => (i + 1) % filtered.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => (i - 1 + filtered.length) % filtered.length);
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                insertMention(filtered[active]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setPopover(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {popover && filtered.length > 0 && (
          <div className="mention-popover" role="listbox">
            {filtered.map((m, i) => {
              const showGroup = i === 0 || filtered[i - 1]?.layerId !== m.layerId;
              return (
                <div key={`${m.layout}:${m.layerId}:${m.id}`}>
                  {showGroup && <div className="mention-group">{m.layerName}</div>}
                  <button
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    className={`mention-option${i === active ? ' active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(m);
                    }}
                  >
                    <span className="mention-option-name">{m.name}</span>
                    <span className="mention-option-id">{m.id}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addImages(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </div>
    );
  },
);
