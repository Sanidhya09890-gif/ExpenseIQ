'use strict';

// Keep the deadline below Render's default 30-second shutdown allowance.
module.exports = function installShutdown(server, app, mongoose, runtime = process, timers = globalThis) {
    let stopping = false;
    async function shutdown() {
        if (stopping) return;
        stopping = true;
        app.locals.shuttingDown = true;
        const deadline = timers.setTimeout(() => {
            server.closeAllConnections?.();
            runtime.exit(1);
        }, 25000);
        deadline.unref?.();
        server.close(async error => {
            try {
                await mongoose.disconnect();
                timers.clearTimeout(deadline);
                runtime.exit(error ? 1 : 0);
            } catch {
                // The deadline remains active if database shutdown stalls/fails.
                runtime.exit(1);
            }
        });
        server.closeIdleConnections?.();
    }
    runtime.on('SIGTERM', shutdown);
    runtime.on('SIGINT', shutdown);
    return shutdown;
};
