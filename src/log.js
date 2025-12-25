// *** MRB *** //
// #### --> MRB <-- ### //
'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import util from 'node:util';

(async () => {
  // --- find package.json (max 2 levels up)
  let name = null;
  let packageJsonPath = null;

  console.log('[log] Initializing app...');

  const searchPaths = [path.join(process.cwd(), 'package.json'), path.join(process.cwd(), '..', 'package.json'), path.join(process.cwd(), '..', '..', 'package.json')];

  for (const searchPath of searchPaths) {
    try {
      await fs.access(searchPath);
      packageJsonPath = searchPath;
      break;
    } catch (_) {
      
    }
  }

  if (!packageJsonPath) {
    console.error('FATAL: Cannot find package.json in current directory or two parent directories');
    process.exit(1);
  }

  try {
    const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(packageJson);
    name = pkg.name;
  } catch (error) {
    console.error('FATAL: Error reading package.json:', error.message);
    process.exit(1);
  }

  // --- logs dir & files
  const logDir = path.resolve('./logs');
  await fs.mkdir(logDir, { recursive: true });
  const infoLog = path.join(logDir, `${name}.log`);
  const errorLog = path.join(logDir, `${name}-error.log`);

  const isProd = process.env.NODE_ENV === 'production';
  const baseLevel = isProd ? 'info' : 'debug';

  // --- pino transport targets
  const targets = [
    {
      target: 'pino/file',
      level: 'info',
      options: { destination: infoLog, mkdir: false },
    },
    {
      target: 'pino/file',
      level: 'error',
      options: { destination: errorLog, mkdir: false },
    },
  ];

  if (!isProd) {
    targets.push({
      target: 'pino-pretty',
      level: 'debug',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
        // ignore: 'pid,hostname' // optionally hide base fields
      },
    });
  }

  const transport = pino.transport({ targets });
  transport.on('error', err => {
    // fallback to original console on transport error
    console.error('log transport failed:', err);
  });

  const logger = pino(
    {
      level: baseLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      seal: true,
      base: null, // don't add pid/hostname by default; change if you want
    },
    transport
  );

  // --- helpers to convert console-like args into (meta, message, error)
  const isPlainObject = v => v && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Error) && !(v instanceof Date);

  function normalizeConsoleArgs(args) {
    // produce a human-friendly message similar to console
    // use util.formatWithOptions to preserve object inspection behavior
    const formatOptions = { colors: false, depth: null, maxArrayLength: null };
    // convert bigints to string to avoid util.format throwing in some contexts
    const safeArgs = args.map(a => (typeof a === 'bigint' ? a.toString() : a));

    const message = util.formatWithOptions(formatOptions, ...safeArgs);

    // collect structured metadata and errors
    const meta = {};
    const errors = [];

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a instanceof Error) {
        errors.push(a);
      } else if (isPlainObject(a) || Array.isArray(a)) {
        // put under argN to avoid key collisions; user can later inspect arg1..argN
        meta[`arg${i}`] = a;
      } else {
        // primitives and strings are already inside message; no need to add
      }
    }

    return { message, meta, errors };
  }

  // --- map console methods to pino levels
  const levelMap = {
    log: 'info',
    info: 'info',
    warn: 'warn',
    error: 'error',
    debug: 'debug',
    trace: 'trace',
  };

  // Save original console for fallback if needed
  const origConsole = { ...console };

  // override methods
  for (const method of Object.keys(levelMap)) {
    const lvl = levelMap[method];

    console[method] = (...args) => {
      try {
        if (!args || args.length === 0) {
          return;
        }

        const { message, meta, errors } = normalizeConsoleArgs(args);

        // If there are Error objects, pass them under `err` (pino special)
        if (errors.length === 1) {
          logger[lvl]({ err: errors[0], ...meta }, message);
        } else if (errors.length > 1) {
          // multiple errors -> attach as array under err.multiple
          logger[lvl]({ err: { multiple: errors }, ...meta }, message);
        } else if (Object.keys(meta).length > 0) {
          logger[lvl](meta, message);
        } else {
          logger[lvl](message);
        }
      } catch (e) {
        // If something goes wrong in logging, fall back to original console to avoid silent failures
        origConsole.error('logger wrapper failed:', e);
        try {
          // still print original message
          origConsole[method]?.(...args);
        } catch (_) {
          // silent
        }
      }
    };
  }

  // implement console.dir to behave similarly (inspect object)
  console.dir = (obj, options = { depth: null }) => {
    const message = util.inspect(obj, { ...options, colors: false });
    logger.debug({ dir: obj }, message);
  };

  // implement console.trace to include stack
  console.trace = (...args) => {
    const { message, meta, errors } = normalizeConsoleArgs(args);
    const stack = new Error().stack;
    const metaWithStack = { ...meta, stack };
    if (errors.length === 1) {
      logger.trace({ err: errors[0], ...metaWithStack }, message);
    } else if (Object.keys(meta).length > 0) {
      logger.trace(metaWithStack, message);
    } else {
      logger.trace(`${message}\n${stack}`);
    }
  };

  console.log('[info] App initialization complete.');

  // --- process-wide handlers
  process.on('uncaughtException', err => {
    // fatal and exit
    logger.fatal({ err }, 'Uncaught exception');
    // give pino a short moment to flush (pino transport handles buffering)
    // but do not block indefinitely
    // setTimeout(() => process.exit(1), 200);
  });

  process.on('unhandledRejection', reason => {
    if (reason instanceof Error) {
      logger.error({ err: reason }, 'Unhandled rejection');
    } else {
      // non-error rejection (string, object, etc.)
      logger.error({ rejection: reason }, 'Unhandled rejection');
    }
  });
})();
// #### --> MRB <-- ### //
