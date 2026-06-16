import type { Message } from './types';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e8f4f8"/>
      <stop offset="50%" stop-color="#d4eaf3"/>
      <stop offset="100%" stop-color="#b8dce8"/>
    </linearGradient>
    <linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f7d794"/>
      <stop offset="100%" stop-color="#eab308"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <circle cx="500" cy="180" r="220" fill="#fff" opacity="0.5"/>
  <circle cx="100" cy="650" r="180" fill="#fff" opacity="0.3"/>
  <text x="50" y="160" font-family="Arial,sans-serif" font-size="72" font-weight="900" fill="#1a3a4a" letter-spacing="-2">夏日</text>
  <text x="50" y="240" font-family="Arial,sans-serif" font-size="72" font-weight="900" fill="#1a3a4a" letter-spacing="-2">清凉季</text>
  <rect x="50" y="270" width="80" height="6" rx="3" fill="url(#warm)"/>
  <text x="50" y="340" font-family="Arial,sans-serif" font-size="24" fill="#4a6a7a">空调直降</text>
  <text x="50" y="380" font-family="Arial,sans-serif" font-size="48" font-weight="900" fill="#e05540">¥500</text>
  <text x="50" y="430" font-family="Arial,sans-serif" font-size="20" fill="#6a8a9a">24小时极速安装 · 全国联保</text>
  <rect x="420" y="540" width="140" height="48" rx="24" fill="#1a3a4a"/>
  <text x="490" y="571" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">立即抢购</text>
  <text x="50" y="680" font-family="Arial,sans-serif" font-size="16" fill="#8aaaba">*活动时间 6.15 - 6.30   |   *限量前1000名</text>
  <rect x="50" y="710" width="320" height="36" rx="8" fill="#1a3a4a" opacity="0.08"/>
  <text x="210" y="734" font-family="Arial,sans-serif" font-size="14" fill="#4a6a7a" text-anchor="middle">输入优惠码 XIAJI 再减 ¥50</text>
</svg>`;

export const MOCK_PREVIEW_SVG = `data:image/svg+xml,${encodeURIComponent(svg)}`;

export const MOCK_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'user',
    text: '帮我设计一张电商促销海报，主题是"夏日清凉季"，卖点是空调直降500元、24小时极速安装。参考风格：简洁现代、蓝白配色。',
  },
  {
    id: '2',
    role: 'assistant',
    text: '已根据你的需求生成设计方案。整体采用蓝白渐变背景，标题使用粗体无衬线字体突出"夏日清凉季"，右下角放置价格标签和CTA按钮。你可以查看左侧预览，或对任意元素提出修改意见。',
  },
  {
    id: '3',
    role: 'user',
    text: '标题字号可以再大一些吗？还有颜色暖一点，现在太冷了。',
    attachments: [],
  },
  {
    id: '4',
    role: 'assistant',
    text: '已将标题字号从 48px 调整为 64px，配色从纯蓝白调整为蓝白渐变并加入暖金色点缀。左侧预览已更新。',
  },
];
