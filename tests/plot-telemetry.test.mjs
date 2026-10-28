import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { balanceType } from '../diagram/lib/data_type.js';
import { PlotHistory } from '../diagram/lib/plot/plot_data.js';

// ブラウザー用の拡張子なしimportだけ解決し、ビルドしたパーサー本体を実行する。
const built = await readFile(new URL('../diagram/lib/plot/plot_telemetry.js', import.meta.url), 'utf8');
const typeURL = new URL('../diagram/lib/data_type.js', import.meta.url).href;
const module = await import(`data:text/javascript;base64,${Buffer.from(built.replace('"../data_type"', JSON.stringify(typeURL))).toString('base64')}`);
const { parseBalanceSample } = module;

// C++ UroaPlotの公開通信仕様に対する固定ベクトル。符号・順序・little endianを検査。
const bytes = Uint8Array.from([2, 1, 255, 255, 254, 255, 255, 255,
    46, 251, 210, 4, 123, 0, 92, 246, 192, 231, 64, 31]);
test('six signed plot fields decode into attitude and percent command panels', () => {
    const sample = parseBalanceSample(new DataView(bytes.buffer));
    assert.equal(sample.sequence, 65535);
    assert.equal(sample.uptime, 4294967294);
    assert.deepEqual(sample.value, {
        attitude: { angle: -12.34, target: 12.34, rate: 1.23, error: -24.68 },
        command: { left: -62.08, right: 80 },
    });
    assert.ok(Object.isFrozen(sample) && Object.isFrozen(sample.value.attitude));
    const history = new PlotHistory(balanceType);
    history.append(sample.value, 0);
    assert.deepEqual(history.groups.map(g => g.name), ['attitude', 'command']);
    assert.deepEqual(history.samples[0].values, [-12.34, 12.34, 1.23, -24.68, -62.08, 80]);
});
test('plot decoder honors DataView slices and rejects IMU and unknown schemas', () => {
    const padded = new Uint8Array(24); padded.set(bytes, 2);
    assert.deepEqual(parseBalanceSample(new DataView(padded.buffer, 2, 20)), parseBalanceSample(new DataView(bytes.buffer)));
    for (const length of [0, 19, 21]) assert.throws(() => parseBalanceSample(new DataView(new ArrayBuffer(length))), /形式/);
    for (const [version, schema] of [[1, 1], [2, 0], [2, 2]]) {
        const invalid = bytes.slice(); invalid[0] = version; invalid[1] = schema;
        assert.throws(() => parseBalanceSample(new DataView(invalid.buffer)), /形式/);
    }
});
