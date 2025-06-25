import cluster from 'cluster';
import os from 'os';
import { logger } from './logger.js';
import { config } from './config.js';

class ClusterManager {
  constructor() {
    this.workers = new Map();
    this.workerCount = config.server.workers || os.cpus().length;
    this.isShuttingDown = false;
    this.restartDelay = 5000; // 5 seconds
    this.maxRestarts = 5;
    this.restartCounts = new Map();
  }

  start() {
    if (cluster.isPrimary) {
      this.startMaster();
    } else {
      this.startWorker();
    }
  }

  startMaster() {
    logger.info(`Master process ${process.pid} starting`);
    logger.info(`Starting ${this.workerCount} workers`);

    // Fork workers
    for (let i = 0; i < this.workerCount; i++) {
      this.forkWorker();
    }

    // Handle worker events
    cluster.on('exit', (worker, code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });

    cluster.on('online', (worker) => {
      logger.info(`Worker ${worker.process.pid} is online`);
      this.workers.set(worker.id, {
        worker,
        startTime: Date.now(),
        restarts: this.restartCounts.get(worker.id) || 0
      });
    });

    cluster.on('disconnect', (worker) => {
      logger.warn(`Worker ${worker.process.pid} disconnected`);
    });

    cluster.on('message', (worker, message) => {
      this.handleWorkerMessage(worker, message);
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());

    // Health monitoring
    this.startHealthMonitoring();

    // Worker rebalancing
    this.startRebalancing();

    logger.info(`Cluster master started with ${this.workerCount} workers`);
  }

  startWorker() {
    try {
      // Import and start the main application
      import('./app.js').then(() => {
        logger.info(`Worker ${process.pid} started successfully`);
        
        // Send health status to master
        setInterval(() => {
          if (process.send) {
            process.send({
              type: 'health',
              pid: process.pid,
              memory: process.memoryUsage(),
              cpu: process.cpuUsage(),
              uptime: process.uptime()
            });
          }
        }, 30000); // Every 30 seconds
      });
    } catch (error) {
      logger.error(`Worker ${process.pid} failed to start:`, error);
      process.exit(1);
    }
  }

  forkWorker() {
    const worker = cluster.fork();
    const restarts = this.restartCounts.get(worker.id) || 0;
    this.restartCounts.set(worker.id, restarts);
    
    // Set up worker timeout
    const timeout = setTimeout(() => {
      if (!worker.isDead()) {
        logger.error(`Worker ${worker.process.pid} startup timeout`);
        worker.kill();
      }
    }, 30000); // 30 second timeout

    worker.on('online', () => {
      clearTimeout(timeout);
    });

    return worker;
  }

  handleWorkerExit(worker, code, signal) {
    const workerInfo = this.workers.get(worker.id);
    this.workers.delete(worker.id);

    if (this.isShuttingDown) {
      logger.info(`Worker ${worker.process.pid} exited during shutdown`);
      return;
    }

    const restarts = this.restartCounts.get(worker.id) || 0;
    
    if (code !== 0 && !worker.exitedAfterDisconnect) {
      logger.error(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
      
      if (restarts < this.maxRestarts) {
        logger.info(`Restarting worker ${worker.id} (attempt ${restarts + 1}/${this.maxRestarts})`);
        this.restartCounts.set(worker.id, restarts + 1);
        
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.forkWorker();
          }
        }, this.restartDelay);
      } else {
        logger.error(`Worker ${worker.id} exceeded maximum restart attempts`);
        this.restartCounts.delete(worker.id);
      }
    } else {
      logger.info(`Worker ${worker.process.pid} exited cleanly`);
    }

    // Ensure we always have enough workers
    if (Object.keys(cluster.workers).length < this.workerCount && !this.isShuttingDown) {
      this.forkWorker();
    }
  }

  handleWorkerMessage(worker, message) {
    switch (message.type) {
      case 'health':
        this.updateWorkerHealth(worker.id, message);
        break;
      case 'error':
        logger.error(`Worker ${worker.process.pid} error:`, message.error);
        break;
      case 'log':
        logger.info(`Worker ${worker.process.pid}:`, message.data);
        break;
      default:
        logger.debug(`Unknown message from worker ${worker.process.pid}:`, message);
    }
  }

  updateWorkerHealth(workerId, healthData) {
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.lastHealth = Date.now();
      workerInfo.health = healthData;
      
      // Check for unhealthy workers
      const memoryUsage = (healthData.memory.heapUsed / healthData.memory.heapTotal) * 100;
      if (memoryUsage > 90) {
        logger.warn(`Worker ${healthData.pid} high memory usage: ${memoryUsage.toFixed(2)}%`);
      }
    }
  }

  startHealthMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const unhealthyWorkers = [];

      for (const [workerId, workerInfo] of this.workers) {
        // Check if worker hasn't reported health in 2 minutes
        if (!workerInfo.lastHealth || (now - workerInfo.lastHealth) > 120000) {
          unhealthyWorkers.push({ workerId, workerInfo });
        }
      }

      // Restart unhealthy workers
      unhealthyWorkers.forEach(({ workerId, workerInfo }) => {
        logger.warn(`Worker ${workerId} appears unhealthy, restarting`);
        if (workerInfo.worker && !workerInfo.worker.isDead()) {
          workerInfo.worker.kill('SIGTERM');
        }
      });
    }, 60000); // Check every minute
  }

  startRebalancing() {
    // Rebalance workers based on load (if needed)
    setInterval(() => {
      const workerCount = Object.keys(cluster.workers).length;
      
      if (workerCount < this.workerCount && !this.isShuttingDown) {
        logger.info(`Worker count below target (${workerCount}/${this.workerCount}), starting new worker`);
        this.forkWorker();
      }
    }, 30000); // Check every 30 seconds
  }

  gracefulShutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('Master process shutting down gracefully');

    const workers = Object.values(cluster.workers);
    let shutdownTimeout;

    const forceShutdown = () => {
      logger.warn('Force killing remaining workers');
      workers.forEach(worker => {
        if (!worker.isDead()) {
          worker.kill('SIGKILL');
        }
      });
      process.exit(1);
    };

    // Set force shutdown timeout
    shutdownTimeout = setTimeout(forceShutdown, 30000); // 30 seconds

    // Gracefully shut down workers
    workers.forEach(worker => {
      if (!worker.isDead()) {
        worker.send({ type: 'shutdown' });
        worker.disconnect();
        
        setTimeout(() => {
          if (!worker.isDead()) {
            worker.kill('SIGTERM');
          }
        }, 10000); // 10 seconds grace period
      }
    });

    // Wait for all workers to exit
    const checkWorkers = setInterval(() => {
      const aliveWorkers = workers.filter(worker => !worker.isDead());
      
      if (aliveWorkers.length === 0) {
        clearInterval(checkWorkers);
        clearTimeout(shutdownTimeout);
        logger.info('All workers shut down, exiting master');
        process.exit(0);
      }
    }, 1000);
  }

  getClusterStatus() {
    const workers = {};
    
    for (const [workerId, workerInfo] of this.workers) {
      workers[workerId] = {
        pid: workerInfo.worker.process.pid,
        state: workerInfo.worker.state,
        startTime: workerInfo.startTime,
        uptime: Date.now() - workerInfo.startTime,
        restarts: workerInfo.restarts,
        lastHealth: workerInfo.lastHealth,
        memory: workerInfo.health ? workerInfo.health.memory : null,
        cpu: workerInfo.health ? workerInfo.health.cpu : null
      };
    }

    return {
      master: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      workers,
      totalWorkers: Object.keys(cluster.workers).length,
      targetWorkers: this.workerCount,
      isShuttingDown: this.isShuttingDown
    };
  }
}

// Handle worker shutdown message
if (!cluster.isPrimary) {
  process.on('message', (message) => {
    if (message.type === 'shutdown') {
      logger.info(`Worker ${process.pid} received shutdown signal`);
      
      // Graceful shutdown of worker
      if (global.server) {
        global.server.close(() => {
          logger.info(`Worker ${process.pid} server closed`);
          process.exit(0);
        });
        
        // Force exit after timeout
        setTimeout(() => {
          logger.warn(`Worker ${process.pid} force exit`);
          process.exit(1);
        }, 10000);
      } else {
        process.exit(0);
      }
    }
  });
}

export const clusterManager = new ClusterManager();
export default clusterManager;
