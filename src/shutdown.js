const handlers = [];

export function onShutdown(fn) {
      handlers.push(fn);
}

let lockExit = false;

async function runShutdown(signal) {
      if (lockExit) return;
      lockExit = true;
      console.info(`[info] shutting down (${signal})`);
      const timeout = setTimeout(() => {
            console.error('[error] shutdown timed out, force exit');
            process.exit(1);
      }, 3000);
      try {
            await Promise.allSettled(handlers.map(h => h(signal)));
            clearTimeout(timeout);
      } catch (_) {
      } finally {
            process.exit(0);
      }
}

process.on('SIGINT', () => runShutdown('SIGINT'));
process.on('SIGTERM', () => runShutdown('SIGTERM'));
process.on('SIGHUP', () => runShutdown('SIGHUP'));

process.on('uncaughtException', _e => runShutdown('uncaughtException'));
process.on('unhandledRejection', _e => runShutdown('unhandledRejection'));

// process.on('exit', () => runShutdown('exit'));
