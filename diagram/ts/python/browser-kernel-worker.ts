/**
 * 固定資産のwccで生成CをWasm化し、Binaryenで最適化する専用Worker。
 * 上流wcc_runner.tsの資産展開・仮想FS・compile/readFileを同じライブラリーで接続する。
 * 受信処理の登録後にreadyを通知する。Binaryenの非同期初期化は要求受信後に行う。
 * コンパイルとBinaryenの共通設定は直列化し、資産はWorker内で一度だけ展開する。
 */
import { unzipSync } from "fflate";
import { loadBrowserAssets, readBrowserAsset } from "./browser-abi";
import { BrowserWasiHost } from "./wasi-host";
import type { NumericKernelArtifact } from "./kernel-c";

/** 固定の割当て用接続コード。共通Cのハッシュとは分離する。 */
const connectionC = `
#include <stdlib.h>
#include <stdint.h>
void *uroa_kernel_alloc(uint32_t bytes) { return malloc(bytes ? bytes : 4); }
void uroa_kernel_free(void *pointer) { free(pointer); }
`;
/** 設定・ファイルを共有する既存WASIホスト。 */
const host = new BrowserWasiHost();
/** 初期化失敗時も呼出し元へ伝える共有Promise。 */
let setup: Promise<void> | undefined;
/** 要求の受信処理を妨げずに遅延初期化する最適化器。失敗後は再読込みを試みる。 */
let optimizer: Promise<typeof import("binaryen")["default"]> | undefined;
/** 要求を一件ずつ処理する待ち行列。 */
let queue = Promise.resolve();

/** 自サイトの固定資産を展開し、上流と同じ絶対パスへ用意する。 */
async function initialize(progress: (message: string) => void): Promise<void> {
    progress("Cコンパイラーの資産情報を取得しています…");
    const assets = await loadBrowserAssets();
    if (assets.wccCommit !== "659a1773f20499864a8c3fdc7cd25cb506092bc1") {
        throw new Error("wccの固定コミットが一致しません");
    }
    progress("Cコンパイラーの資産を取得・確認しています…");
    const archive = await readBrowserAsset("wccfiles.zip", assets);
    progress("Cコンパイラーの資産を展開しています…");
    const files = unzipSync(archive);
    const fs = host.filesystem.fs;
    for (const directory of ["/tmp", "/home/wasm"]) {
        fs.mkdirSync(directory, { recursive: true });
    }
    for (const [name, data] of Object.entries(files)) {
        const target = "/" + name;
        fs.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
        fs.writeFileSync(target, data);
    }
}

/** 生成Cのハッシュ・設定を検証してからコンパイルし、計算用Wasmだけを最適化する。 */
async function compile(artifact: NumericKernelArtifact, progress: (message: string) => void): Promise<Uint8Array<ArrayBuffer>> {
    await (setup ??= initialize(progress).catch(error => {
        setup = undefined;
        throw error;
    }));
    const { manifest, generatedC } = artifact;
    progress("生成Cと登録情報を確認しています…");
    const input = JSON.stringify([1, "unsafe-fast-v1", generatedC, manifest.kernels.map(entry => [entry.id, entry.name, entry.argumentTypes])]);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))), value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== manifest.kernelSetHash || manifest.build.browser.binaryenVersion !== "132.0.0"
        || manifest.build.browser.wccCommit !== "659a1773f20499864a8c3fdc7cd25cb506092bc1"
        || manifest.build.browser.optimizeLevel !== 3 || manifest.build.browser.shrinkLevel !== 0 || !manifest.build.browser.fastMath
        || manifest.profile !== "unsafe-fast-v1" || manifest.designVersion !== 1) {
        throw new Error("カーネルの成果物・固定版が一致しません");
    }
    const fs = host.filesystem.fs;
    for (const name of fs.readdirSync("/tmp")) {
        fs.unlinkSync("/tmp/" + name);
    }
    let diagnostics = "";
    host.output = text => { diagnostics += text; };
    fs.writeFileSync("/home/wasm/kernel.c", generatedC + connectionC);
    if (fs.existsSync("/home/wasm/kernel.wasm")) {
        fs.unlinkSync("/home/wasm/kernel.wasm");
    }
    const exports = [...manifest.kernels.map(entry => entry.publicName), "uroa_kernel_alloc", "uroa_kernel_free"];
    progress("wccでCをWebAssemblyへ変換しています…");
    const status = await host.compile(["/usr/bin/cc", "--entry-point=", "-e", exports.join(","), "-o", "/home/wasm/kernel.wasm", "/home/wasm/kernel.c"]);
    if (status !== 0) {
        throw new Error(`Cコンパイル失敗 (${status}):\n${diagnostics}`);
    }
    progress("Binaryenを読み込み・初期化しています…");
    const binaryen = await (optimizer ??= import("binaryen").then(module => module.default).catch(error => {
        optimizer = undefined;
        throw error;
    }));
    progress("BinaryenでWebAssemblyを最適化しています…");
    const module = binaryen.readBinary(new Uint8Array(fs.readFileSync("/home/wasm/kernel.wasm") as Uint8Array));
    try {
        binaryen.setOptimizeLevel(3);
        binaryen.setShrinkLevel(0);
        binaryen.setFastMath(true);
        module.optimize();
        if (!module.validate()) {
            throw new Error("最適化後のWasmが不正です");
        }
        progress("最適化済みWebAssemblyを出力しています…");
        return new Uint8Array(module.emitBinary());
    }
    finally {
        module.dispose();
        for (const name of fs.readdirSync("/tmp")) {
            fs.unlinkSync("/tmp/" + name);
        }
    }
}

self.onmessage = event => {
    const { id, artifact } = event.data;
    queue = queue.then(async () => {
        try {
            const wasm = await compile(artifact, message => self.postMessage({ id, kind: "progress", message }));
            self.postMessage({ id, wasm }, { transfer: [wasm.buffer] });
        }
        catch (error) {
            self.postMessage({ id, error: String(error) });
        }
    });
};

// 受信処理を設定してから通知し、親はこの通知後にだけ要求を送信する。
self.postMessage({ kind: "ready" });
