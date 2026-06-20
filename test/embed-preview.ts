import { embedImagesInHtml, getCompletedImageRefs } from '../src/render/embed-images';
import * as fs from 'fs';

const html = fs.readFileSync('test/output/assembled.html', 'utf-8');
const asset = JSON.parse(fs.readFileSync('test/output/illustrator-bg-full.json', 'utf-8'));
const refs = getCompletedImageRefs([asset]);
console.log('图片引用:', refs.length);

const embedded = embedImagesInHtml(html, refs);
fs.writeFileSync('public/designer-output.html', embedded, 'utf-8');
console.log('输出:', embedded.length, '字符, 包含 data:image:', embedded.includes('data:image'));
