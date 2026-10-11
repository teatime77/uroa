let controller = new AbortController();

export function animationSignal(): AbortSignal { return controller.signal; }

export function cancelAnimationSession(): void { controller.abort(); }

export function beginAnimationSession(): AbortSignal {
    controller.abort();
    controller = new AbortController();
    return controller.signal;
}
