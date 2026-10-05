/**
 * 二分定位：完整提示词里哪一段触发了内容审核？
 *
 * 已知：
 *   - 极简干净提示词 + 参考图 ×2  → 通过
 *   - 完整提示词（有无参考图都）  → 稳定被 InputTextSensitiveContentDetected 拦截
 * 结论：触发源在提示词文本中。
 *
 * 按语义切块逐段试，找出到底哪一块有问题。
 */

import { readFileSync } from 'node:fs';

const keys = JSON.parse(readFileSync('keys.json', 'utf8'));
const ark = keys.providers.find((p: { name: string }) => p.name === 'volcano-ark');
const endpoint = `${ark.baseURL}/images/generations`;
const model = ark.models[0].model;

// 完整提示词按语义切块
const BLOCKS = {
  S1_场景: 'Fotorealistische Aufnahme einer fröhlichen Geburtstagsfeier in einem warmen, gemütlich eingerichteten Wohnzimmer am Abend.',
  S2_男士举牌:
    'Im Vordergrund hält ein dunkelhaariger Mann mit kurzem Bart das Akazienholzbrett aus dem Referenzbild mit beiden Händen hoch und lacht herzlich in die Kamera.',
  S3_女士: 'Links neben ihm lacht eine braunhaarige Frau ihn an.',
  S4_宾客: 'Hinter den beiden stehen weitere Gäste, stark unscharf.',
  S5_气球: 'Rechts oben schwebt ein goldener Folienballon in Form der Zahl 40.',
  S6_蛋糕: 'Links unten auf dem Tisch eine Geburtstagstorte mit brennenden Kerzen.',
  S7_光线: 'Warmes, weiches Innenlicht, viele goldene Bokeh-Lichter im Hintergrund, sehr geringe Schärfentiefe, festliche Stimmung.',
  S8_留白: 'Der obere linke Bildbereich bleibt ruhig und unaufgeregt, damit dort später Text Platz findet.',
  S9_人体: 'WICHTIG: Gesichter müssen natürlich und scharf sein, keine verzerrten oder verschmutzten Gesichter, Hände mit korrekt fünf Fingern.',
  S10_雕刻:
    'Auf dem Brett steht exakt die Gravur aus dem Referenzbild: «SCHONEND BEHANDELN», darunter «KLASSIKER», darunter gross die Zahl «40», darunter in Schreibschrift «Zustand entspricht Alter und Laufleistung», darunter drei kleine Symbole mit Text.',
  S11_字母: 'Die Buchstaben müssen korrekt sein, kein Fantasietext.',
  S12_禁项: 'Keine weiteren Schriften oder Buchstaben im Bild, keine Logos, kein Wasserzeichen, keine Fremdmarken.',
};

async function call(label: string, prompt: string) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ark.apiKey}` },
    body: JSON.stringify({ model, prompt, size: '2048x2048', response_format: 'url' }),
  });
  const text = await res.text();
  let v = `HTTP ${res.status}`;
  if (res.ok) v += '  ✓ 通过';
  else {
    try {
      v += `  ✗ ${JSON.parse(text).error?.code ?? ''}`;
    } catch {
      v += `  ✗ ${text.slice(0, 80)}`;
    }
  }
  console.log(`  ${label.padEnd(46)} ${v}`);
  return res.ok;
}

async function main() {
  console.log('\n逐段测试（每段单独提交）\n' + '─'.repeat(72));

  const singles: [string, string][] = [
    ['S2_男士举牌', BLOCKS.S2_男士举牌],
    ['S6_蛋糕（燃烧的蜡烛）', BLOCKS.S6_蛋糕],
    ['S9_人体（脸/手）', BLOCKS.S9_人体],
    ['S10_雕刻（整段文字）', BLOCKS.S10_雕刻],
    ['S12_禁项（Logos/Marken）', BLOCKS.S12_禁项],
  ];

  for (const [name, text] of singles) {
    await call(name, text);
  }

  console.log('\n组合测试\n' + '─'.repeat(72));
  const combo = (keys: (keyof typeof BLOCKS)[]) =>
    keys.map((k) => BLOCKS[k]).join(' ');

  await call('除 S9 外的全部', combo(['S1_场景', 'S2_男士举牌', 'S3_女士', 'S4_宾客', 'S5_气球', 'S6_蛋糕', 'S7_光线', 'S8_留白', 'S10_雕刻', 'S11_字母', 'S12_禁项']));
  await call('除 S10 外的全部', combo(['S1_场景', 'S2_男士举牌', 'S3_女士', 'S4_宾客', 'S5_气球', 'S6_蛋糕', 'S7_光线', 'S8_留白', 'S9_人体', 'S11_字母', 'S12_禁项']));
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
