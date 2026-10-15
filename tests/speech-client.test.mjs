import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizeSpeech } from '../diagram/lib/ai/speech-client.js';

class Recognition {
    starts = 0;
    aborts = 0;
    start() { this.starts++; this.onstart?.(); }
    abort() { this.aborts++; this.onend?.(); }
    result(text, isFinal = true) { this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] }); }
}
const options = signal => ({ signal, lang: 'ja-JP', timeoutMs: 1000 });

test('waits for end, ignores interim text, and handles repeated result snapshots', async () => {
    const r = new Recognition(), c = new AbortController();
    let done = false;
    const p = recognizeSpeech(r, options(c.signal)).then(text => { done = true; return text; });
    assert.equal(r.lang, 'ja-JP');
    assert.equal(r.continuous, false);
    r.result('途中', false);
    r.result('  質問です  '); r.result('  質問です  ');
    await Promise.resolve(); assert.equal(done, false);
    r.onend();
    assert.equal(await p, '質問です');
    assert.equal(r.onresult, null);
    assert.equal(r.aborts, 0);
    c.abort(); assert.equal(r.aborts, 0);
});

for (const error of ['not-allowed', 'no-speech', 'network', 'audio-capture', 'language-not-supported', 'secret-service-detail']) {
    test(`${error} rejects, releases the recognizer, and suppresses late events`, async () => {
        const r = new Recognition(), c = new AbortController();
        const p = recognizeSpeech(r, options(c.signal));
        const late = r.onresult, end = r.onend;
        r.onerror({ error });
        late({ results: [{ isFinal: true, 0: { transcript: 'late' } }] }); end();
        await assert.rejects(p, e => !e.message.includes('secret-service-detail'));
        assert.equal(r.aborts, 1);
        assert.equal(r.onend, null);
    });
}

test('an empty session rejects rather than publishing an old or blank result', async () => {
    const r = new Recognition();
    const p = recognizeSpeech(r, options(new AbortController().signal));
    r.result('partial', false); r.onend();
    await assert.rejects(p, /空/);
});

test('cancellation settles even when abort throws or never produces end', async () => {
    for (const throws of [false, true]) {
        const r = new Recognition(), c = new AbortController();
        r.abort = () => { r.aborts++; if (throws) throw new Error('abort failed'); };
        const p = recognizeSpeech(r, options(c.signal));
        c.abort();
        await assert.rejects(p, /中断/);
        assert.equal(r.aborts, 1);
    }
    const r = new Recognition(), c = new AbortController(); c.abort();
    await assert.rejects(recognizeSpeech(r, options(c.signal)), /中断/);
    assert.equal(r.starts, 0);
});

test('timeout and a synchronous start failure both abort and reject', async () => {
    const r = new Recognition();
    await assert.rejects(recognizeSpeech(r, { ...options(new AbortController().signal), timeoutMs: 5 }), /時間切れ/);
    assert.equal(r.aborts, 1);
    const broken = new Recognition(); broken.start = () => { throw new Error('native detail'); };
    await assert.rejects(recognizeSpeech(broken, options(new AbortController().signal)), /開始できません/);
    assert.equal(broken.aborts, 1);
});
