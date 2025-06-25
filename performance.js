import { performance } from 'perf_hooks';
import { logger, logPerformance, logSystemHealth } from './logger.js';
import { config } from './config.js';
import os from 'os';
import cluster from 'cluster';

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.intervals = new Map();
    this.enabled = config.monitoring.enabled;
    this.startTime = Date.now();
    
    if (this.enabled) {
      this.startMonitoring();
    }
  }

  startMonitoring() {
    // System health monitoring
    const healthInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, config.monitoring.metricsInterval);
    
    this.intervals.set('health', healthInterval);

    // Database performance monitoring
    const dbInterval = setInterval(() => {
      this.collectDatabaseMetrics();
    }, config.monitoring.metricsInterval * 2);
    
    this.intervals.set('database', dbInterval);

    // Memory usage monitoring
    const memoryInterval = setInterval(() => {
      this.collectMemoryMetrics();
    }, config.monitoring.metricsInterval);
    
    this.intervals.set('memory', memoryInterval);

    logger.info('Performance monitoring started');
  }

  collectSystemMetrics() {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    const loadAvg = os.loadavg();
    
    const metrics = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      cpu: {
        user: cpuUsage.user / 1000000, // Convert to seconds
        system: cpuUsage.system / 1000000,
        usage: (cpuUsage.user + cpuUsage.system) / 1000000
      },
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        usage: (memUsage.heapUsed / memUsage.heapTotal) * 100
      },
      system: {
        loadAvg: loadAvg,
        freeMem: os.freemem(),
        totalMem: os.totalmem(),
        memoryUsage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      }
    };

    this.metrics.set('system', metrics);
    
    // Log critical metrics
    if (metrics.memory.usage > 80) {
      logger.warn('High memory usage detected', { usage: metrics.memory.usage });
    }
    
    if (metrics.system.memoryUsage > 90) {
      logger.warn('High system memory usage detected', { usage: metrics.system.memoryUsage });
    }

    logSystemHealth();
  }

  collectDatabaseMetrics() {
    const start = performance.now();
    
    // Simulate database performance check
    // In real implementation, this would query database stats
    setTimeout(() => {
      const duration = performance.now() - start;
      
      const metrics = {
        timestamp: Date.now(),
        queryTime: duration,
        connections: 1, // Would be actual connection count
        slowQueries: 0, // Would be actual slow query count
        errors: 0 // Would be actual error count
      };

      this.metrics.set('database', metrics);
      
      if (duration > 1000) { // 1 second threshold
        logger.warn('Slow database operation detected', { duration });
      }
    }, 1);
  }

  collectMemoryMetrics() {
    if (global.gc) {
      const before = process.memoryUsage();
      global.gc();
      const after = process.memoryUsage();
      
      const cleaned = before.heapUsed - after.heapUsed;
      
      if (cleaned > 0) {
        logger.info('Garbage collection completed', {
          cleaned: Math.round(cleaned / 1024 / 1024) + 'MB',
          before: Math.round(before.heapUsed / 1024 / 1024) + 'MB',
          after: Math.round(after.heapUsed / 1024 / 1024) + 'MB'
        });
      }
    }
  }

  // Middleware for request performance monitoring
  createMiddleware() {
    return (req, res, next) => {
      const startTime = performance.now();
      const startCpu = process.cpuUsage();
      
      // Override res.end to capture metrics
      const originalEnd = res.end;
      res.end = function(...args) {
        const endTime = performance.now();
        const endCpu = process.cpuUsage(startCpu);
        const duration = endTime - startTime;
        
        // Log performance metrics
        logPerformance('http_request', duration, {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          cpu: {
            user: endCpu.user / 1000,
            system: endCpu.system / 1000
          }
        });

        // Track slow requests
        if (duration > 5000) { // 5 second threshold
          logger.warn('Slow request detected', {
            method: req.method,
            url: req.url,
            duration: `${duration}ms`,
            status: res.statusCode
          });
        }

        originalEnd.apply(this, args);
      };

      next();
    };
  }

  // Database operation performance tracking
  trackDatabaseOperation(operation, table, callback) {
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const wrappedCallback = (error, result) => {
        const duration = performance.now() - start;
        
        logPerformance('database_operation', duration, {
          operation,
          table,
          success: !error,
          recordCount: Array.isArray(result) ? result.length : (result ? 1 : 0)
        });

        if (error) {
          logger.error('Database operation failed', {
            operation,
            table,
            error: error.message,
            duration
          });
          reject(error);
        } else {
          if (duration > 100) { // 100ms threshold
            logger.warn('Slow database operation', {
              operation,
              table,
              duration: `${duration}ms`
            });
          }
          resolve(result);
        }
      };

      if (callback) {
        callback(wrappedCallback);
      } else {
        return wrappedCallback;
      }
    });
  }

  // Cron job performance tracking
  trackCronExecution(jobId, command, callback) {
    const start = performance.now();
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const wrappedCallback = (error, result) => {
        const duration = performance.now() - start;
        const endTime = Date.now();
        
        logPerformance('cron_execution', duration, {
          jobId,
          command: command.substring(0, 100), // Limit command length
          success: !error,
          startTime,
          endTime
        });

        if (error) {
          logger.error('Cron job execution failed', {
            jobId,
            command,
            error: error.message,
            duration
          });
          reject(error);
        } else {
          logger.info('Cron job executed successfully', {
            jobId,
            duration: `${duration}ms`
          });
          resolve(result);
        }
      };

      if (callback) {
        callback(wrappedCallback);
      } else {
        return wrappedCallback;
      }
    });
  }

  // Get current metrics
  getMetrics() {
    const allMetrics = {};
    for (const [key, value] of this.metrics) {
      allMetrics[key] = value;
    }
    
    return {
      ...allMetrics,
      uptime: Date.now() - this.startTime,
      processId: process.pid,
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cpuCount: os.cpus().length,
      workers: cluster.workers ? Object.keys(cluster.workers).length : 1
    };
  }

  // Health check endpoint data
  getHealthCheck() {
    const metrics = this.getMetrics();
    const memory = process.memoryUsage();
    const memoryUsage = (memory.heapUsed / memory.heapTotal) * 100;
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        usage: `${Math.round(memoryUsage)}%`,
        heap: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`
      },
      cpu: metrics.system ? metrics.system.loadAvg : os.loadavg(),
      version: process.version,
      environment: process.env.NODE_ENV || 'development'
    };
  }

  // Cleanup and stop monitoring
  stop() {
    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
      logger.info(`Stopped ${name} monitoring`);
    }
    
    this.intervals.clear();
    this.metrics.clear();
    logger.info('Performance monitoring stopped');
  }
}

// Create singleton instance
const monitor = new PerformanceMonitor();

export { monitor as performanceMonitor };
export default monitor;
