import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

/**
 * Structured logging configuration for JIT Bot
 * Uses pino for high-performance JSON logging with trace ID propagation
 */

export interface LogContext {
  traceId?: string;
  poolAddress?: string;
  swapHash?: string;
  blockNumber?: number;
  [key: string]: any;
}

/**
 * Enhanced logger with trace context
 */
export interface ContextLogger {
  debug(msg: string, extra?: LogContext): void;
  info(msg: string, extra?: LogContext): void;
  warn(msg: string, extra?: LogContext): void;
  error(msg: string, extra?: LogContext): void;
  child(context: LogContext): ContextLogger;
  withTrace(traceId: string): ContextLogger;
  newTrace(): { traceId: string; logger: ContextLogger };
}

/**
 * Create base pino logger with appropriate configuration
 */
function createBaseLogger(): pino.Logger {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  return pino({
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    base: {
      service: 'jit-bot',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      simulationMode: process.env.SIMULATION_MODE !== 'false',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    ...(isDevelopment && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '{service}[{component}] {msg}',
        },
      },
    }),
  });
}

// Singleton base logger
const baseLogger = createBaseLogger();

/**
 * Create a component-specific logger with enhanced context capabilities
 */
export function createLogger(component: string, initialContext: LogContext = {}): ContextLogger {
  const componentLogger = baseLogger.child({
    component,
    ...initialContext,
  });

  const createContextLogger = (logger: pino.Logger, context: LogContext = {}): ContextLogger => {
    return {
      debug(msg: string, extra: LogContext = {}) {
        logger.debug({ ...context, ...extra }, msg);
      },

      info(msg: string, extra: LogContext = {}) {
        logger.info({ ...context, ...extra }, msg);
      },

      warn(msg: string, extra: LogContext = {}) {
        logger.warn({ ...context, ...extra }, msg);
      },

      error(msg: string, extra: LogContext = {}) {
        logger.error({ ...context, ...extra }, msg);
      },

      child(childContext: LogContext): ContextLogger {
        const childLogger = logger.child(childContext);
        return createContextLogger(childLogger, { ...context, ...childContext });
      },

      withTrace(traceId: string): ContextLogger {
        return this.child({ traceId });
      },

      newTrace(): { traceId: string; logger: ContextLogger } {
        const traceId = uuidv4();
        return {
          traceId,
          logger: this.withTrace(traceId),
        };
      },
    };
  };

  return createContextLogger(componentLogger, initialContext);
}

/**
 * Express middleware to add request tracing
 */
export function requestTracing() {
  return (req: any, res: any, next: any) => {
    const traceId = uuidv4();
    req.traceId = traceId;
    
    // Add traceId to response headers for debugging
    res.setHeader('X-Trace-ID', traceId);
    
    // Create request logger
    req.logger = createLogger('http').withTrace(traceId);
    
    req.logger.info('Request started', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });

    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      req.logger.info('Request completed', {
        statusCode: res.statusCode,
        duration,
      });
    });

    next();
  };
}

/**
 * Performance measurement utilities
 */
export class PerformanceLogger {
  private logger: ContextLogger;
  private startTime: number;
  private checkpoints: { name: string; time: number; duration: number }[] = [];

  constructor(logger: ContextLogger, operation: string) {
    this.logger = logger.child({ operation });
    this.startTime = Date.now();
    this.logger.debug('Operation started');
  }

  checkpoint(name: string): void {
    const now = Date.now();
    const duration = now - this.startTime;
    const checkpoint = { name, time: now, duration };
    this.checkpoints.push(checkpoint);
    
    this.logger.debug('Checkpoint reached', {
      checkpoint: name,
      duration,
      totalDuration: duration,
    });
  }

  finish(success: boolean = true, extra: LogContext = {}): void {
    const totalDuration = Date.now() - this.startTime;
    
    this.logger.info('Operation completed', {
      success,
      totalDuration,
      checkpoints: this.checkpoints.length,
      ...extra,
    });
    
    if (this.checkpoints.length > 0) {
      this.logger.debug('Operation checkpoints', {
        checkpoints: this.checkpoints,
      });
    }
  }

  static measure<T>(
    logger: ContextLogger,
    operation: string,
    fn: (perf: PerformanceLogger) => Promise<T>
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      const perf = new PerformanceLogger(logger, operation);
      
      try {
        const result = await fn(perf);
        perf.finish(true);
        resolve(result);
      } catch (error: any) {
        perf.finish(false, { error: error.message });
        reject(error);
      }
    });
  }
}

/**
 * Error logging utilities with structured error information
 */
export function logError(
  logger: ContextLogger,
  error: Error,
  context: string,
  extra: LogContext = {}
): void {
  logger.error(`Error in ${context}`, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    context,
    ...extra,
  });
}

/**
 * Safe JSON serialization for logging complex objects
 */
export function safeStringify(obj: any, maxDepth: number = 3): string {
  const seen = new WeakSet();
  
  const replacer = (key: string, value: any, depth: number = 0): any => {
    if (depth > maxDepth) {
      return '[Max Depth Reached]';
    }
    
    if (value === null) return null;
    
    if (typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
      
      if (value.toString && value.toString !== Object.prototype.toString) {
        // Handle BigNumber and similar objects
        return value.toString();
      }
      
      // Recursively process objects
      const result: any = Array.isArray(value) ? [] : {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = replacer(k, v, depth + 1);
      }
      return result;
    }
    
    if (typeof value === 'bigint') {
      return value.toString();
    }
    
    return value;
  };
  
  try {
    return JSON.stringify(obj, (key, value) => replacer(key, value));
  } catch (error) {
    return `[Serialization Error: ${error}]`;
  }
}

// Export the main logger for backward compatibility
export const logger = createLogger('main');

// Log startup information
logger.info('Logging system initialized', {
  level: baseLogger.level,
  environment: process.env.NODE_ENV || 'development',
  simulationMode: process.env.SIMULATION_MODE !== 'false',
});

export default createLogger;