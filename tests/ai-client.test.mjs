import assert from 'node:assert/strict';
import test from 'node:test';
import { interactionAnswer, checkAIResponse, waitAIRequest } from '../diagram/lib/ai-client.js';

test('REST parsing selects the final model output, combines text, and omits thoughts', () => {
    assert.equal(interactionAnswer({ status: 'completed', steps: [
        { type: 'model_output', content: [{ type: 'text', text: 'intermediate' }] },
        { type: 'thought', content: [{ type: 'text', text: 'private reasoning' }] },
        { type: 'model_output', content: [{ type: 'text', text: '回答' }, { type: 'image', data: 'unused' }, { type: 'text', text: 'です。' }] },
    ] }), '回答です。');
    for (const body of [null, { status: 'requires_action', steps: [] }, { status: 'completed', steps: [] },
        { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '  ' }] }] }]) {
        assert.throws(() => interactionAnswer(body));
    }
});

test('HTTP errors reveal only fixed messages, without reading a credential-containing body', () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
        const response = new Response('secret-key', { status });
        assert.throws(() => checkAIResponse(response), error => !error.message.includes('secret-key'));
        assert.equal(response.bodyUsed, false);
    }
});

test('request wait cancels a transport ignoring abort and cleans up the timeout', async () => {
    const controller = new AbortController();
    const request = waitAIRequest(controller, 1000, () => new Promise(() => {}));
    controller.abort();
    await assert.rejects(request, /中断/);
    const completed = new AbortController();
    assert.equal(await waitAIRequest(completed, 10, async () => 'done'), 'done');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(completed.signal.aborted, false);
});
