import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config';

// Global logger instance
let globalLogger: pino.Logger | null = null;

// Trace context for correlation
export interface TraceContext {
  traceId: string;
  candidateId?: string;
  poolAddress?: string;
  operation?: string;
}

// Logger configuration based on environment
function createLoggerConfig(): pino.LoggerOptions {
  const config = getConfig();
  
  const baseConfig: pino.LoggerOptions = {
    name: 'jit-bot',
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({ 
        pid: bindings.pid,
        hostname: bindings.hostname 
      })
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'privateKey',
        'flashbotsPrivateKey',
        'rpcUrl',
        'rpcUrlHttp',
        'rpcUrlWs',
        '*.privateKey',
        '*.secret',
        '*.password'
      ],
      censor: '[REDACTED]'
    }
  };

  // Production logging configuration
  if (config.nodeEnv === 'production') {
    return {
      ...baseConfig,
      transport: {
        target: 'pino/file',
        options: {
          destination: process.stdout.isTTY ? undefined : 'logs/jit-bot.log'
        }
      }
    };
  }

  // Development logging configuration
  return {
    ...baseConfig,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  };
}

/**
 * Initialize the global logger
 */
export function initializeLogger(): pino.Logger {
  if (!globalLogger) {
    const config = createLoggerConfig();
    globalLogger = pino(config);
    
    globalLogger.info({
      msg: 'Logger initialized',
      nodeEnv: process.env.NODE_ENV,
      logLevel: globalLogger.level
    });
  }
  
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): pino.Logger {
  if (!globalLogger) {
    return initializeLogger();
  }
  return globalLogger;
}

/**
 * Create a child logger with trace context
 */
export function createTraceLogger(context: Partial<TraceContext> = {}): pino.Logger {
  const logger = getLogger();
  
  const traceContext: TraceContext = {
    traceId: context.traceId || generateTraceId(),
    ...context
  };
  
  return logger.child(traceContext);
}

/**
 * Generate a new trace ID
 */
export function generateTraceId(): string {
  return uuidv4();
}

/**
 * Create a candidate-specific logger for tracking opportunities
 */
export function createCandidateLogger(
  poolAddress: string,
  swapHash?: string,
  parentTraceId?: string
): pino.Logger {
  const candidateId = swapHash || uuidv4();
  
  return createTraceLogger({
    traceId: parentTraceId || generateTraceId(),
    candidateId,
    poolAddress,
    operation: 'candidate-processing'
  });
}

/**
 * Log structured data for JIT opportunities
 */
export interface JitOpportunityLog {
  traceId: string;
  candidateId: string;
  poolAddress: string;
  swapHash?: string;
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  estimatedProfitUsd: number;
  gasPrice: string;
  timestamp: number;
  stage: 'detected' | 'simulated' | 'validated' | 'executed' | 'failed';
  result?: 'profitable' | 'unprofitable' | 'error';
  reason?: string;
  executionTimeMs?: number;
}

/**
 * Log JIT opportunity with structured data
 */
export function logJitOpportunity(
  logger: pino.Logger,
  data: JitOpportunityLog
): void {
  const level = data.stage === 'failed' ? 'warn' : 'info';
  
  logger[level]({
    ...data,
    msg: `JIT opportunity ${data.stage}`,
    component: 'jit-processor'
  });
}

/**
 * Log performance metrics
 */
export interface PerformanceLog {
  operation: string;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
}

export function logPerformance(
  logger: pino.Logger,
  data: PerformanceLog
): void {
  logger.info({
    ...data,
    msg: `Performance: ${data.operation}`,
    component: 'performance'
  });
}

/**
 * Log error with context
 */
export function logError(
  logger: pino.Logger,
  error: Error,
  context: Record<string, any> = {}
): void {
  logger.error({
    err: error,
    ...context,
    msg: error.message,
    component: 'error-handler'
  });
}

/**
 * Log simulation results
 */
export interface SimulationLog {
  traceId: string;
  poolAddress: string;
  simulationType: 'fast' | 'fork';
  profitable: boolean;
  estimatedProfitUsd: number;
  gasEstimate: string;
  executionTimeMs: number;
  validations?: Record<string, boolean>;
  warnings?: string[];
}

export function logSimulationResult(
  logger: pino.Logger,
  data: SimulationLog
): void {
  logger.info({
    ...data,
    msg: `Simulation completed: ${data.simulationType}`,
    component: 'simulator'
  });
}

/**
 * Log bundle execution attempt
 */
export interface BundleLog {
  traceId: string;
  bundleHash?: string;
  targetBlock: number;
  gasPrice: string;
  success: boolean;
  profitEth?: string;
  gasUsed?: number;
  executionTimeMs: number;
  reason?: string;
}

export function logBundleExecution(
  logger: pino.Logger,
  data: BundleLog
): void {
  const level = data.success ? 'info' : 'warn';
  
  logger[level]({
    ...data,
    msg: `Bundle execution ${data.success ? 'succeeded' : 'failed'}`,
    component: 'bundle-executor'
  });
}

/**
 * Log pool state changes
 */
export interface PoolStateLog {
  poolAddress: string;
  tick: number;
  liquidity: string;
  price: string;
  blockNumber: number;
  timestamp: number;
  source: 'cache' | 'rpc';
}

export function logPoolState(
  logger: pino.Logger,
  data: PoolStateLog
): void {
  logger.debug({
    ...data,
    msg: 'Pool state updated',
    component: 'pool-monitor'
  });
}

/**
 * Create a timer for measuring operation duration
 */
export function createTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

/**
 * Middleware for Express to add request logging
 */
export function requestLoggingMiddleware() {
  const logger = getLogger();
  
  return (req: any, res: any, next: any) => {
    const traceId = generateTraceId();
    req.traceId = traceId;
    req.logger = logger.child({ traceId, component: 'http' });
    
    const timer = createTimer();
    
    req.logger.info({
      msg: 'HTTP request started',
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent')
    });
    
    res.on('finish', () => {
      req.logger.info({
        msg: 'HTTP request completed',
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: timer()
      });
    });
    
    next();
  };
}

/**
 * Log configuration on startup (with secrets redacted)
 */
export function logStartupConfiguration(): void {
  const logger = getLogger();
  const config = getConfig();
  
  logger.info({
    msg: 'Bot configuration loaded',
    nodeEnv: config.nodeEnv,
    chain: config.chain,
    simulationMode: config.simulationMode,
    maxGasGwei: config.maxGasGwei,
    globalMinProfitUsd: config.globalMinProfitUsd,
    poolIds: config.poolIds,
    prometheusPort: config.prometheusPort,
    component: 'startup'
  });
  
  if (config.simulationMode) {
    logger.warn({
      msg: 'Running in SIMULATION MODE - no live transactions will be executed',
      component: 'startup'
    });
  }
}

/**
 * Graceful shutdown logging
 */
export function logShutdown(reason: string): void {
  const logger = getLogger();
  
  logger.info({
    msg: 'JIT Bot shutting down',
    reason,
    component: 'shutdown'
  });
}

/**
 * Flush logs (useful for graceful shutdown)
 */
export function flushLogs(): Promise<void> {
  return new Promise((resolve) => {
    if (globalLogger) {
      globalLogger.flush();
    }
    // Give some time for logs to flush
    setTimeout(resolve, 100);
  });
}