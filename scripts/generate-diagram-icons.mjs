import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Original vector artwork. Keep bold, simple shapes legible at ToolItem's 32px size.
const icons = [
    ['BLEConnectionBlock', 'BLE接続', '#2563eb',
        '<path d="M23 8v32l12-10-20-15m0 18 20-15L23 8"/>'],
    ['IMUBlock', '姿勢・加速度センサー', '#0891b2',
        '<path d="M23 27V9m-4 5 4-5 4 5M23 27h17m-5-4 5 4-5 4M23 27 10 39m0-6v6h6"/><circle cx="23" cy="27" r="3" fill="#0891b2" stroke="none"/>'],
    ['PlotBlock', 'グラフ', '#0891b2',
        '<path d="M9 9v30h31"/><path d="m13 31 7-10 7 6 8-14 5 5"/>'],
    ['IfBlock', '条件分岐', '#d97706',
        '<path d="m24 7 10 10-10 10-10-10Z M14 17H9v20h9m-4-4 4 4-4 4M34 17h5v20h-9m4-4-4 4 4 4"/>'],
    ['InfiniteLoop', '繰り返し', '#d97706',
        '<path d="M24 24c-5-7-8-10-12-10a10 10 0 0 0 0 20c4 0 7-3 12-10s8-10 12-10a10 10 0 0 1 0 20c-4 0-7-3-12-10Z"/>'],
    ['TTSBlock', '文字を読み上げる', '#9333ea',
        '<path d="M8 19h8l9-7v24l-9-7H8Z M31 18a9 9 0 0 1 0 12M35 12a17 17 0 0 1 0 24"/>'],
    ['SleepBlock', '待機', '#d97706',
        '<path d="M14 8h20M14 40h20M16 8v7c0 4 5 6 8 9-3 3-8 5-8 9v7M32 8v7c0 4-5 6-8 9 3 3 8 5 8 9v7M19 13h10m-10 23h10"/>'],
    ['TriggerGate', 'イベントで実行', '#d97706',
        '<path d="m26 7-13 19h10l-2 15 14-22H25Z" fill="#fef3c7"/>'],
    ['InputTextBlock', '文字列入力', '#0f766e',
        '<rect x="7" y="11" width="34" height="27" rx="4"/><path d="m13 31 6-14 6 14m-10-5h8M33 17v14m-3-14h6m-6 14h6"/>'],
    ['InputNumberBlock', '数値入力', '#0f766e',
        '<rect x="7" y="11" width="34" height="27" rx="4"/><path d="m21 17-3 15m12-15-3 15M14 22h20M13 28h20"/>'],
    ['CompareBlock', '値の比較', '#7c3aed',
        '<path d="m17 10-9 9 9 9m14-18 9 9-9 9M20 33h8M20 39h8"/>'],
    ['InputRangeBlock', 'スライダー入力', '#0f766e',
        '<path d="M7 24h34M9 18v12m30-12v12"/><rect x="19" y="15" width="9" height="18" rx="3" fill="#ccfbf1"/>'],
    ['ServoMotorBlock', 'サーボモーター', '#dc2626',
        '<rect x="11" y="19" width="26" height="20" rx="3"/><path d="M7 25h4m26 0h4M24 19V9m-8 0h18M16 39v4m16-4v4"/><circle cx="24" cy="28" r="5"/>'],
    ['CameraBlock', 'カメラ', '#0891b2',
        '<path d="M8 17h8l3-6h10l3 6h8v22H8Z"/><circle cx="24" cy="27" r="7"/><path d="M12 21h3"/>'],
    ['FaceDetectionBlock', '顔の検出', '#0891b2',
        '<path d="M7 16V8h8m18 0h8v8M7 32v8h8m18 0h8v-8"/><ellipse cx="24" cy="24" rx="10" ry="13"/><path d="M20 20h.1m7.9 0h.1M20 29q4 4 8 0"/>'],
    ['CalcBlock', '計算', '#7c3aed',
        '<rect x="12" y="7" width="24" height="34" rx="4"/><path d="M17 12h14v7H17Z M17 27h6m-3-3v6M27 27h4M17 35h6M27 33h4m-4 4h4"/>'],
    ['UltrasonicDistanceSensorBlock', '超音波距離センサー', '#0891b2',
        '<rect x="5" y="11" width="38" height="22" rx="3"/><circle cx="15" cy="22" r="6"/><circle cx="33" cy="22" r="6"/><path d="M16 33v5m8-5v5m8-5v5M19 40q5 4 10 0"/>'],
    ['ConditionGate', '条件で通す', '#d97706',
        '<path d="M13 12h10a12 12 0 0 1 0 24H13Z M5 18h8M5 30h8M35 24h8"/><path d="m18 24 4 4 7-9" stroke="#15803d"/>'],
    ['PlayMovieBlock', '教材動画を再生', '#9333ea',
        '<path d="M8 17h32v23H8Z M8 8h32v9H8Z M13 8l-4 9m13-9-4 9m13-9-4 9m13-9-4 9"/><path d="m21 23 10 6-10 6Z" fill="#f3e8ff"/>'],
    ['PlayGameBlock', '学習ゲーム', '#9333ea',
        '<path d="M16 15h16c5 0 7 4 8 10l2 9c1 5-4 7-7 4l-6-6H19l-6 6c-3 3-8 1-7-4l2-9c1-6 3-10 8-10Z"/><path d="M12 24h10m-5-5v10M31 22h.1m4.9 6h.1"/>'],
    ['PlayWebGPUBlock', 'GPUシミュレーション', '#9333ea',
        '<rect x="12" y="12" width="24" height="24" rx="3"/><path d="M18 6v6m6-6v6m6-6v6M18 36v6m6-6v6m6-6v6M6 18h6m-6 6h6m-6 6h6M36 18h6m-6 6h6m-6 6h6M18 20l6-3 6 3v8l-6 3-6-3Z M18 20l6 4 6-4m-6 4v7"/>'],
    ['AIChatBlock', 'AIチャット', '#c026d3',
        '<path d="M7 10h34v25H23l-9 7v-7H7Z"/><path d="m24 15 2.5 5.5L32 23l-5.5 2.5L24 31l-2.5-5.5L16 23l5.5-2.5Z" fill="#fae8ff"/><path d="M35 15v4m-2-2h4"/>'],
    ['SpeechRecognitionBlock', '音声認識', '#c026d3',
        '<rect x="19" y="7" width="10" height="22" rx="5"/><path d="M13 23v2a11 11 0 0 0 22 0v-2M24 36v6m-6 0h12M7 18v11m34-11v11"/>'],
    ['ObjectDetectionBlock', 'Gemini物体検出', '#c026d3',
        '<path d="M7 17V8h10m14 0h10v9M7 31v9h10m14 0h10v-9"/><rect x="13" y="16" width="14" height="17" rx="2"/><circle cx="32" cy="25" r="7"/>'],
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/diagram/images/toolbox');
await mkdir(output, { recursive: true });
for (const [name, label, color, artwork] of icons) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 48 48" role="img" aria-labelledby="title">
  <title id="title">${label}</title>
  <rect x="1" y="1" width="46" height="46" rx="8" fill="#fff" stroke="#cbd5e1" stroke-width="1.5"/>
  <g fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${artwork}</g>
</svg>
`;
    await writeFile(resolve(output, `${name}.svg`), svg, 'utf8');
}

const cards = icons.map(([name, label]) => `<article><div class="samples"><img src="images/toolbox/${name}.svg" width="32" height="32" alt="${label}"><img src="images/toolbox/${name}.svg" width="80" height="80" alt=""></div><h2>${label}</h2><p>${name}</p></article>`).join('\n');
await writeFile(resolve(root, 'public/diagram/toolbox-icons.html'), `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>diagram ブロックアイコン一覧</title>
<style>body{margin:0;padding:24px;background:#eef2f6;color:#17384f;font:15px system-ui,sans-serif}h1{font-size:24px;margin:0 0 8px}header p{margin:0 0 24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}article{background:white;border:1px solid #d9e2ec;border-radius:12px;padding:16px}.samples{display:flex;align-items:center;justify-content:center;gap:24px;background:#f1f5f9;border-radius:8px;padding:12px}h2{font-size:16px;margin:12px 0 4px}article p{font:12px ui-monospace,monospace;margin:0;overflow-wrap:anywhere}</style></head>
<body><header><h1>diagram ブロックアイコン</h1><p>全${icons.length}種類。左がToolItem用の32px、右が拡大表示です。</p></header><main>${cards}</main></body></html>
`, 'utf8');
console.log(`Generated ${icons.length} toolbox SVG icons and toolbox-icons.html.`);
