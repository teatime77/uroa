import { cancelSpeech, disposeSpeech, msg } from "@i18n";
import { initAlgebra } from "@algebra";
import { initDiagram, stopDiagram, disposeDiagram } from "@diagram";
import { initURL, pathName, setOnLeaveModule } from "../../diagram/ts/diagram_util";
import { setStopChildren } from "../../diagram/ts/runtime";
import { initGame, stopGame, disposeGame } from "@game";
import { initMovie, stopMovie, disposeMovie } from "@movie";
import { initWebGPU, stopWebGPU, disposeWebGPU } from "@webgpu";
import { AppLifecycle } from "./lifecycle";
import type { AppModule } from "./lifecycle";

const modules: Record<string, AppModule> = {
    algebra: { init: initAlgebra, stop: cancelSpeech, dispose: cancelSpeech },
    diagram: { init: initDiagram, stop: stopDiagram, dispose: disposeDiagram },
    game: { init: initGame, stop: stopGame, dispose: disposeGame },
    movie: { init: initMovie, stop: stopMovie, dispose: disposeMovie },
    webgpu: { init: initWebGPU, stop: stopWebGPU, dispose: disposeWebGPU },
};

export let application: AppLifecycle;

function boot(): void {
    if (window.uroaApp) {
        application = window.uroaApp;
        return;
    }
    // URL and DOM access happen after DOM readiness, not during module evaluation.
    initURL();
    setStopChildren(() => { stopGame(); stopMovie(); stopWebGPU(); });
    setOnLeaveModule(id => {
        // Entering a child layer is part of the current diagram procedure.
        if (id === "layer-game") stopGame();
        if (id === "layer-movie") stopMovie();
        if (id === "layer-webgpu") stopWebGPU();
    });
    const name = Object.keys(modules).find(name => pathName.startsWith(`/${name}`));
    const selected = name === "diagram"
        ? [modules.diagram, modules.game, modules.webgpu, modules.movie]
        : name ? [modules[name]] : [];
    selected.unshift({
        init: async () => {},
        stop: cancelSpeech,
        dispose: () => {
            window.removeEventListener("pagehide", pagehide);
            disposeSpeech();
            setStopChildren(() => {});
            setOnLeaveModule(() => {});
            delete (window as Partial<Window>).injectTestData;
        },
    });
    application = new AppLifecycle(selected, () => {
        if (name === "diagram") msg("diagram ready");
        if (!name) msg("no project");
    });
    window.uroaApp = application;
    window.injectTestData = data => {
        console.log("AI Agentからのデータを受信しました:", data);
        document.body.style.backgroundColor = data.bgColor || "white";
    };
    const pagehide = (event: PageTransitionEvent) => {
        if (event.persisted) application.stop();
        else void dispose().catch(error => console.error("uroa cleanup failed", error));
    };
    window.addEventListener("pagehide", pagehide);
    async function dispose(): Promise<void> {
        window.removeEventListener("pagehide", pagehide);
        await application.dispose();
    }
    if (import.meta.hot) import.meta.hot.dispose(() => { void dispose(); });
    void application.start().catch(error => console.error("uroa initialization failed", error));
}

declare global {
    interface Window {
        uroaApp: AppLifecycle;
        injectTestData: (data: any) => void;
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
    boot();
}
