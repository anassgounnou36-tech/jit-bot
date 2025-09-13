import { prometheusMetrics } from './prom';
import { createLogger } from '../logging/logger';

const logger = createLogger('MetricsServer');

/**
 * Standalone metrics server for the "metrics" script
 */
async function startMetricsServer(): Promise<void> {
  try {
    // Initialize placeholder metrics for PR1
    prometheusMetrics.initializePlaceholders();
    
    // Start the metrics server
    await prometheusMetrics.start();
    
    logger.info('Standalone metrics server started successfully');
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down metrics server...');
      await prometheusMetrics.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down metrics server...');
      await prometheusMetrics.stop();
      process.exit(0);
    });

  } catch (error: any) {
    logger.error('Failed to start metrics server', { error: error.message });
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startMetricsServer();
}