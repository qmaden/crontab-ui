import winston from 'winston';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// Ensure log directory exists
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for development
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} ${level}: ${message} ${stack || ''}`;
  })
);

// Custom format for production
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
      silent: process.env.NODE_ENV === 'test'
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    }),
    
    // Separate file for errors
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.error.log'),
      level: 'error',
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.exceptions.log')
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.rejections.log')
    })
  ]
});

// Performance logger for monitoring
const performanceLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.performance.log'),
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles
    })
  ]
});

// Security logger for security events
const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.security.log'),
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles
    })
  ]
});

// Middleware for request logging
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;
    
    // Log response
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // Log performance metrics
    performanceLogger.info('Request performance', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      ip: req.ip,
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    });

    originalEnd.apply(this, args);
  };

  next();
};

// Security event logger
const logSecurityEvent = (event, details = {}) => {
  securityLogger.warn('Security event', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

// Error logger for application errors
const logError = (error, context = {}) => {
  logger.error('Application error', {
    error: error.message,
    stack: error.stack,
    ...context,
    timestamp: new Date().toISOString()
  });
};

// Performance monitoring
const logPerformance = (operation, duration, metadata = {}) => {
  performanceLogger.info('Performance metric', {
    operation,
    duration,
    ...metadata,
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage()
  });
};

// Database operation logger
const logDatabaseOperation = (operation, table, duration, recordCount = null) => {
  performanceLogger.info('Database operation', {
    operation,
    table,
    duration,
    recordCount,
    timestamp: new Date().toISOString()
  });
};

// Cron job execution logger
const logCronExecution = (jobId, command, status, duration, output = null) => {
  logger.info('Cron job execution', {
    jobId,
    command,
    status,
    duration,
    output: output ? output.substring(0, 1000) : null, // Limit output length
    timestamp: new Date().toISOString()
  });
};

// System health logger
const logSystemHealth = () => {
  const usage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  performanceLogger.info('System health', {
    memory: {
      rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
      external: Math.round(usage.external / 1024 / 1024) + 'MB'
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
};

// Log cleanup function
const cleanupLogs = () => {
  const logFiles = [
    config.logging.file,
    config.logging.file.replace('.log', '.error.log'),
    config.logging.file.replace('.log', '.performance.log'),
    config.logging.file.replace('.log', '.security.log'),
    config.logging.file.replace('.log', '.exceptions.log'),
    config.logging.file.replace('.log', '.rejections.log')
  ];

  logFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      
      if (ageInDays > 30) { // Keep logs for 30 days
        fs.unlinkSync(file);
        logger.info(`Cleaned up old log file: ${file}`);
      }
    }
  });
};

// Schedule log cleanup
if (config.logging.cleanup !== false) {
  setInterval(cleanupLogs, 24 * 60 * 60 * 1000); // Daily cleanup
}

export {
  logger,
  performanceLogger,
  securityLogger,
  requestLogger,
  logSecurityEvent,
  logError,
  logPerformance,
  logDatabaseOperation,
  logCronExecution,
  logSystemHealth,
  cleanupLogs
};

export default logger;
