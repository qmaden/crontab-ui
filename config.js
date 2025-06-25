// Performance and environment configuration
import os from 'os';
import 'dotenv/config';

export const config = {
  // Server configuration
  server: {
    host: process.env.HOST || '127.0.0.1',
    port: parseInt(process.env.PORT) || 8000,
    workers: parseInt(process.env.CLUSTER_WORKERS) || os.cpus().length,
    enableCluster: process.env.ENABLE_CLUSTER === 'true',
    keepAliveTimeout: 65000,
    headersTimeout: 66000,
    maxHeaderSize: 8192,
    environment: process.env.NODE_ENV || 'development',
    forceHttps: process.env.FORCE_HTTPS === 'true',
    maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb'
  },

  // Database configuration
  database: {
    type: process.env.DB_TYPE || 'sqlite', // 'sqlite' or 'redis'
    sqlite: {
      filename: process.env.CRON_DB_PATH ? 
        `${process.env.CRON_DB_PATH}/crontab.db` : 
        './crontabs/crontab.db',
      options: {
        verbose: process.env.NODE_ENV === 'development' ? console.log : null,
        fileMustExist: false,
        timeout: 5000,
        readonly: false,
      }
    },
    redis: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    }
  },

  // Cache configuration
  cache: {
    enabled: process.env.ENABLE_CACHE !== 'false',
    ttl: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes
    maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES) || 1000,
    type: process.env.CACHE_TYPE || 'memory', // 'memory' or 'redis'
  },

  // Security configuration
  security: {
    auth: {
      required: process.env.DISABLE_AUTH !== 'true',
      user: process.env.BASIC_AUTH_USER || 'admin',
      password: process.env.BASIC_AUTH_PWD || 'changeme',
      realm: 'Crontab UI - Performance Enhanced',
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
      strictMax: parseInt(process.env.RATE_LIMIT_STRICT_MAX) || 20,
    },
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "cdn.datatables.net"],
          scriptSrc: ["'self'", "'unsafe-inline'", "cdn.datatables.net"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
    },
  },

  // Compression configuration
  compression: {
    enabled: process.env.DISABLE_COMPRESSION !== 'true',
    level: parseInt(process.env.COMPRESSION_LEVEL) || 6,
    threshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 1024,
    filter: (req, res) => {
      // Don't compress if client explicitly requests no compression
      if (req.headers['x-no-compression']) return false;
      // Default compression for text-based content
      return /json|text|javascript|css|xml|html/.test(res.get('Content-Type'));
    }
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
    file: process.env.LOG_FILE || './logs/crontab-ui.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
    datePattern: 'YYYY-MM-DD',
  },

  // Performance monitoring
  monitoring: {
    enabled: process.env.ENABLE_MONITORING === 'true',
    metricsInterval: parseInt(process.env.METRICS_INTERVAL) || 30000,
    healthCheckEndpoint: '/health',
    metricsEndpoint: '/metrics',
  },

  // File paths
  paths: {
    dbFolder: process.env.CRON_DB_PATH || './crontabs',
    logFolder: process.env.CRON_LOG_PATH || './crontabs/logs',
    cronPath: process.env.CRON_PATH || '/tmp',
    publicPath: './public',
    viewsPath: './views',
  },

  // Application features
  features: {
    autoSave: process.env.ENABLE_AUTOSAVE === 'true',
    backup: {
      enabled: process.env.ENABLE_BACKUP !== 'false',
      maxBackups: parseInt(process.env.MAX_BACKUPS) || 10,
      autoBackupInterval: parseInt(process.env.AUTO_BACKUP_INTERVAL) || 24 * 60 * 60 * 1000, // 24 hours
    },
    import: {
      maxFileSize: parseInt(process.env.MAX_IMPORT_SIZE) || 10 * 1024 * 1024, // 10MB
      allowedExtensions: ['.db', '.json'],
    },
    export: {
      compression: process.env.EXPORT_COMPRESSION === 'true',
      format: process.env.EXPORT_FORMAT || 'db', // 'db' or 'json'
    },
  },

  // SSL configuration
  ssl: {
    enabled: !!(process.env.SSL_KEY && process.env.SSL_CERT),
    key: process.env.SSL_KEY,
    cert: process.env.SSL_CERT,
    ca: process.env.SSL_CA,
    passphrase: process.env.SSL_PASSPHRASE,
  },
};

export default config;
