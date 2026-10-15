import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataType, Struct, Field, imuType, numberType, stringType } from '../diagram/lib/data_type.js';
import { PlotHistory, getPlotGroups, getStatistics, getThreeSigmaScale } from '../diagram/lib/plot/plot_data.js';

test('panels and RGB series are discovered from registered Fields', () => {
    const groups = getPlotGroups(imuType);
    assert.deepEqual(groups.map(group => group.name), ['gyro', 'acc']);
    assert.deepEqual(groups[0].series.map(series => [series.path, series.color]), [
        [['gyro', 'x'], 'red'], [['gyro', 'y'], 'green'], [['gyro', 'z'], 'blue'],
    ]);
    const weather = new Struct('plot-weather', [new Field('temperature', numberType), new Field('label', stringType)]);
    const station = new Struct('plot-station', [new Field('outside', new DataType(weather.name))]);
    assert.deepEqual(getPlotGroups(new DataType(station.name))[0].series[0].path, ['outside', 'temperature']);
    assert.equal(getPlotGroups(numberType)[0].series[0].path.length, 0);
    assert.deepEqual(getPlotGroups(stringType), []);
});

test('population statistics use each series mean, including nonzero offsets', () => {
    const statistics = getStatistics([1, 2, 3, 4]);
    assert.equal(statistics.mean, 2.5);
    assert.equal(statistics.sigma, Math.sqrt(1.25));
    const scale = getThreeSigmaScale([{ mean: -5, sigma: 1 }, { mean: 10, sigma: 2 }]);
    assert.ok(scale.range[0] <= -8 && scale.range[1] >= 16);
    assert.ok(scale.dtick > 0);
});

test('empty and constant data have a usable finite axis range', () => {
    assert.deepEqual(getStatistics([]), { mean: 0, sigma: 0 });
    for (const mean of [0, 9.80665, -100]) {
        const scale = getThreeSigmaScale([{ mean, sigma: 0 }]);
        assert.ok(scale.range[0] < mean && scale.range[1] > mean);
        assert.ok(scale.range.every(Number.isFinite) && scale.dtick > 0);
    }
});

test('history retains only the rolling window and bounds sample count', () => {
    const history = new PlotHistory(numberType, 30, 3);
    history.append(1, 1000); history.append(2, 2000); history.append(3, 3000); history.append(4, 4000);
    assert.deepEqual(history.samples.map(sample => sample.values[0]), [2, 3, 4]);
    history.append(5, 35000);
    assert.deepEqual(history.samples.map(sample => sample.values[0]), [5]);
    history.clear(); history.append(6, 99000);
    assert.equal(history.samples[0].time, 0);
});

test('all nested numeric values are sampled atomically and invalid input is rejected', () => {
    const history = new PlotHistory(imuType);
    history.append({ gyro: { x: 1, y: 2, z: 3 }, acc: { x: 4, y: 5, z: 6 } }, 0);
    assert.deepEqual(history.samples[0].values, [1, 2, 3, 4, 5, 6]);
    assert.equal(history.getScales().length, 2);
    assert.throws(() => history.append({ gyro: { x: 1, y: 2, z: 3 } }, 100), /フィールド/);
    assert.equal(history.samples.length, 1);
});
