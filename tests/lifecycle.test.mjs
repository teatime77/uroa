import assert from "node:assert/strict";
import { test } from "node:test";
import { AppLifecycle } from "../app/lib/lifecycle.js";

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test("concurrent startup initializes once and preserves module order", async () => {
    const gate = deferred(), events = [];
    const module = name => ({
        init: async () => { events.push(name); if (name === "diagram") await gate.promise; },
        stop: () => events.push(`stop ${name}`),
        dispose: () => events.push(`dispose ${name}`),
    });
    const app = new AppLifecycle([module("diagram"), module("game"), module("webgpu"), module("movie")]);
    const first = app.start();
    assert.equal(app.start(), first);
    gate.resolve();
    await first;
    await app.start();
    assert.equal(app.state, "ready");
    assert.deepEqual(events, ["diagram", "game", "webgpu", "movie"]);
    app.stop();
    assert.equal(app.state, "ready"); // Stop retains initialized UI for another playback.
    await app.dispose();
    assert.deepEqual(events.slice(-4), ["dispose movie", "dispose webgpu", "dispose game", "dispose diagram"]);
    await assert.rejects(app.start(), /disposed/);
});

test("failure releases partially initialized resources without starting later modules", async () => {
    const events = [], error = new Error("initialization failed");
    const broken = {
        init: async () => { throw error; },
        stop: () => events.push("stop"),
        dispose: () => events.push("dispose"),
    };
    const app = new AppLifecycle([broken, { ...broken, init: async () => events.push("unexpected") }]);
    await assert.rejects(app.start(), error);
    assert.equal(app.state, "failed");
    assert.equal(app.error, error);
    await assert.rejects(app.start(), error);
    assert.deepEqual(events, ["stop", "dispose"]);
    await app.dispose();
    assert.equal(app.state, "disposed");
});

test("dispose during startup releases resources acquired after an await exactly once", async () => {
    const gate = deferred(), events = [];
    const app = new AppLifecycle([{
        init: async signal => { await gate.promise; events.push(signal.aborted ? "aborted" : "ready"); },
        stop: () => {},
        dispose: () => events.push("disposed"),
    }], () => events.push("unexpected ready"));
    const startup = app.start();
    const teardown = app.dispose();
    assert.equal(app.dispose(), teardown);
    gate.resolve();
    await Promise.all([startup, teardown]);
    assert.deepEqual(events, ["aborted", "disposed"]);
    assert.equal(app.state, "disposed");
});

test("a cleanup failure still releases the remaining modules", async () => {
    const events = [];
    const module = name => ({
        init: async () => {}, stop: () => {},
        dispose: () => { events.push(name); if (name === "second") throw new Error("cleanup"); },
    });
    const app = new AppLifecycle([module("first"), module("second")]);
    await app.start();
    await assert.rejects(app.dispose(), AggregateError);
    assert.deepEqual(events, ["second", "first"]);
    assert.equal(app.state, "disposed");
});

test("stop during initialization aborts startup and suppresses its ready callback", async () => {
    const gate = deferred(), events = [];
    const module = {
        init: async signal => { await gate.promise; assert.equal(signal.aborted, true); },
        stop: () => {}, dispose: () => {},
    };
    const app = new AppLifecycle([module, { ...module, init: async () => events.push("unexpected") }], () => events.push("ready"));
    const startup = app.start();
    app.stop();
    gate.resolve();
    await startup;
    assert.equal(app.state, "stopped");
    assert.deepEqual(events, []);
    await app.dispose();
});
