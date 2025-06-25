#!/usr/bin/env node

/**
 * Crontab UI - Performance Enhanced Entry Point
 * Supports both single-process and multi-process cluster modes
 */

import 'dotenv/config';
import { config } from './config.js';
import { logger } from './logger.js';
import { clusterManager } from './cluster.js';

// Performance optimizations
if (process.env.NODE_ENV === 'production') {
  // Enable garbage collection optimization
  if (global.gc) {
    setInterval(() => {
      global.gc();
    }, 30000); // Run GC every 30 seconds
  }
  
  // Increase max listeners for better performance
  process.setMaxListeners(20);
  
  // Handle memory warnings
  process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') {
      logger.warn('Max listeners exceeded:', warning);
    }
  });
}

// Display startup banner
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  🚀 CRONTAB UI v0.5.0                       ║
║              Performance Enhanced Edition                     ║
╠══════════════════════════════════════════════════════════════╣
║  Features:                                                   ║
║  ✅ ES Modules & Latest Node.js                             ║
║  ✅ Multi-core Clustering                                   ║ 
║  ✅ SQLite + Redis Support                                  ║
║  ✅ Performance Monitoring                                  ║
║  ✅ Enhanced Security                                       ║
║  ✅ Compression & Caching                                   ║
║  ✅ Modern Database Layer                                   ║
║  ✅ Graceful Shutdown                                       ║
╚══════════════════════════════════════════════════════════════╝
`);

// Log configuration
logger.info('Starting Crontab UI with configuration:', {
  mode: config.server.enableCluster ? 'cluster' : 'single',
  workers: config.server.workers,
  database: config.database.type,
  caching: config.cache.enabled ? config.cache.type : 'disabled',
  monitoring: config.monitoring.enabled,
  compression: config.compression.enabled,
  ssl: config.ssl.enabled,
  authentication: config.security.auth.required,
  environment: process.env.NODE_ENV || 'development'
});

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));

if (majorVersion < 20) {
  logger.error(`Node.js version ${nodeVersion} is not supported. Please upgrade to Node.js 20 or higher.`);
  process.exit(1);
}

// Environment checks
const requiredVars = [];
if (config.database.type === 'redis') {
  requiredVars.push('REDIS_HOST');
}
if (config.ssl.enabled) {
  requiredVars.push('SSL_KEY', 'SSL_CERT');
}

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    logger.error(`Required environment variable ${varName} is not set`);
    process.exit(1);
  }
}

// Security warnings
if (config.security.auth.user === 'admin' && config.security.auth.password === 'changeme') {
  logger.warn('⚠️  SECURITY WARNING: Using default credentials! Change BASIC_AUTH_USER and BASIC_AUTH_PWD immediately!');
}

if (!config.ssl.enabled && process.env.NODE_ENV === 'production') {
  logger.warn('⚠️  SECURITY WARNING: SSL not enabled in production. Consider setting SSL_KEY and SSL_CERT.');
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start application
try {
  if (config.server.enableCluster) {
    logger.info(`Starting in cluster mode with ${config.server.workers} workers`);
    clusterManager.start();
  } else {
    logger.info('Starting in single-process mode');
    // Import and start the application directly
    await import('./app.js');
  }
} catch (error) {
  logger.error('Failed to start application:', error);
  process.exit(1);
}

// Export for testing
export { config };
