import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import compression from 'express-compression';
import basicAuth from 'express-basic-auth';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import validator from 'validator';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import multer from 'multer';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import 'dotenv/config';

// Local imports
import { config } from './config.js';
import { db } from './database.js';
import { logger, requestLogger, logSecurityEvent, logError } from './logger.js';
import { performanceMonitor } from './performance.js';
import { clusterManager } from './cluster.js';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure dayjs
dayjs.extend(relativeTime);

// Initialize DOMPurify for server-side XSS protection
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Create Express app
const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Performance middleware
if (config.monitoring.enabled) {
  app.use(performanceMonitor.createMiddleware());
}

// Request logging
app.use(requestLogger);

// Compression middleware
if (config.compression.enabled) {
  app.use(compression({
    level: config.compression.level,
    threshold: config.compression.threshold,
    filter: config.compression.filter
  }));
}

// Security middleware
app.use(helmet(config.security.helmet));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  max: config.security.rateLimit.max,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent('rate_limit_exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    res.status(429).json({ error: 'Too many requests from this IP, please try again later.' });
  }
});
app.use(limiter);

// Stricter rate limiting for sensitive operations
const strictLimiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  max: config.security.rateLimit.strictMax,
  message: { error: 'Too many sensitive operations from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent('strict_rate_limit_exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    res.status(429).json({ error: 'Too many sensitive operations from this IP, please try again later.' });
  }
});

// Parse JSON and URL-encoded data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.features.import.maxFileSize,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop();
    if (config.features.import.allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Static file serving with caching
app.use('/static', express.static(config.paths.publicPath, {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    }
  }
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', config.paths.viewsPath);

// Enhanced input validation and sanitization
function validateAndSanitize(input, type = 'general') {
  if (!input || typeof input !== 'string') return false;
  
  // Sanitize XSS using DOMPurify
  input = purify.sanitize(input);
  
  switch (type) {
    case 'command':
      // Enhanced dangerous command patterns
      const dangerousPatterns = [
        /\brm\s+(-rf\s+)?\//, // rm with root paths
        /\bmv\s+.*\s+\//, // mv to root
        /\bcp\s+.*\s+\//, // cp to root  
        /\bchmod\s+(777|666)/, // dangerous permissions
        /\bchown\s+root/, // changing to root ownership
        /\b(su|sudo)\s+/, // privilege escalation
        /\b(wget|curl).*\|\s*(sh|bash)/, // download and execute
        /\b(nc|netcat).*-e/, // reverse shells
        /\b(eval|exec)\s*\(/, // code execution
        />\s*.*\/(etc|bin|sbin|usr\/bin|usr\/sbin)/, // redirect to system dirs
        /\;\s*(rm|mv|cp)\s+/, // chained dangerous commands
        /\|\s*(rm|mv|cp)\s+/, // piped dangerous commands
        /\&\&\s*(rm|mv|cp)\s+/, // conditional dangerous commands
        /\b(format|mkfs|fdisk|dd.*of=\/dev|reboot|shutdown|halt|poweroff)\b/i, // destructive commands
        /\b(iptables|ufw|firewall).*(-D|-F|--delete|--flush)/i, // firewall manipulation
        /\bcrontab\s+-r/i, // crontab removal
        /\b(kill|killall|pkill).*-9/i, // force kill
        /\bmount.*\/dev/i, // device mounting
        /\bumount.*-f/i, // force unmount
        /\b(service|systemctl).*stop/i, // service stopping
      ];
      
      for (let pattern of dangerousPatterns) {
        if (pattern.test(input)) {
          logSecurityEvent('dangerous_command_blocked', {
            command: input,
            pattern: pattern.toString()
          });
          return false;
        }
      }
      break;
      
    case 'schedule':
      // Enhanced cron expression validation
      if (input.startsWith('@')) {
        const validMacros = ['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'];
        return validMacros.includes(input) ? input : false;
      }
      
      // Validate cron pattern (5 or 6 fields)
      const cronParts = input.split(/\s+/);
      if (cronParts.length < 5 || cronParts.length > 6) return false;
      
      // Basic field validation
      const patterns = [
        /^(\*|[0-5]?[0-9]|[0-5]?[0-9]-[0-5]?[0-9]|[0-5]?[0-9]\/[0-9]+|\*\/[0-9]+)$/, // minute
        /^(\*|[01]?[0-9]|2[0-3]|[01]?[0-9]-[01]?[0-9]|2[0-3]-2[0-3]|[01]?[0-9]\/[0-9]+|\*\/[0-9]+)$/, // hour
        /^(\*|[01]?[0-9]|[12][0-9]|3[01]|[01]?[0-9]-[01]?[0-9]|[12][0-9]-[12][0-9]|3[01]-3[01]|[01]?[0-9]\/[0-9]+|\*\/[0-9]+)$/, // day
        /^(\*|[01]?[0-9]|1[0-2]|[01]?[0-9]-[01]?[0-9]|1[0-2]-1[0-2]|[01]?[0-9]\/[0-9]+|\*\/[0-9]+)$/, // month
        /^(\*|[0-6]|[0-6]-[0-6]|[0-6]\/[0-9]+|\*\/[0-9]+)$/ // day of week
      ];
      
      for (let i = 0; i < Math.min(cronParts.length, 5); i++) {
        if (!patterns[i].test(cronParts[i])) {
          return false;
        }
      }
      break;
      
    case 'name':
      // Validate job name
      if (input.length > 100) return false;
      if (!/^[a-zA-Z0-9_\-\s\.]+$/.test(input)) return false;
      break;
      
    case 'env':
      // Validate environment variables
      const lines = input.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          if (!/^[A-Z_][A-Z0-9_]*\s*=/.test(trimmed)) {
            return false;
          }
        }
      }
      break;
  }
  
  return input;
}

// Authentication middleware
if (config.security.auth.required) {
  app.use((req, res, next) => {
    res.setHeader('WWW-Authenticate', `Basic realm="${config.security.auth.realm}"`);
    next();
  });

  app.use(basicAuth({
    users: {
      [config.security.auth.user]: config.security.auth.password
    },
    challenge: true,
    realm: config.security.auth.realm,
    unauthorizedResponse: (req) => {
      logSecurityEvent('authentication_failed', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url
      });
      return { error: 'Authentication required' };
    }
  }));

  // Log successful authentication
  app.use((req, res, next) => {
    logSecurityEvent('authentication_success', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      user: req.auth?.user
    });
    next();
  });
}

// Initialize database and start application
(async () => {
  await db.initialize();

  const { routes } = await import('./routes.js');

  async function renderIndex(res, env) {
  try {
    const crontabs = await db.getAllCrontabs();
    const stats = await db.getStats();
    let backups = [];
    try {
      backups = fs.readdirSync(config.paths.crontabsPath);
      backups = backups.filter(x => x.endsWith('.db'));
    } catch (e) {
      // ignore
    }

    const processedCrontabs = await Promise.all(
      crontabs.map(async (crontab) => {
        const processed = { ...crontab };
        try {
          if (crontab.schedule === "@reboot") {
            processed.human = "At system startup";
            processed.next = "Next Reboot";
          } else if (crontab.schedule.startsWith("@")) {
            const macros = {
              "@yearly": "Once a year (0 0 1 1 *)",
              "@annually": "Once a year (0 0 1 1 *)",
              "@monthly": "Once a month (0 0 1 * *)",
              "@weekly": "Once a week (0 0 * * 0)",
              "@daily": "Once a day (0 0 * * *)",
              "@midnight": "Once a day (0 0 * * *)",
              "@hourly": "Once an hour (0 * * * *)"
            };
            processed.human = macros[crontab.schedule] || crontab.schedule;
            if (crontab.schedule !== "@reboot") {
              const { parseExpression } = await import('cron-parser');
              processed.next = parseExpression(crontab.schedule).next().toString();
            }
          } else {
            const [{ toString }, { parseExpression }] = await Promise.all([
              import('cronstrue/i18n'),
              import('cron-parser')
            ]);
            processed.human = toString(crontab.schedule, { locale: 'en' });
            processed.next = parseExpression(crontab.schedule).next().toString();
          }
        } catch (err) {
          logger.error('Error parsing schedule for job:', crontab._id, err);
          processed.human = "Invalid schedule";
          processed.next = "invalid";
        }
        return processed;
      })
    );

    res.render('index', {
      crontabs: JSON.stringify(processedCrontabs),
      stats: JSON.stringify(stats),
      moment: dayjs,
      routes: JSON.stringify(routes),
      env: env || '',
      backups: backups,
      config: {
        version: '0.5.0',
        features: config.features
      }
    });
  } catch (error) {
    logError(error, { route: '/', ip: res.req.ip });
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Root route - Dashboard
app.get('/', async (req, res) => {
  try {
    await renderIndex(res, process.env.CRON_IN_DOCKER);
  } catch (error) {
    logError(error, { route: '/', ip: req.ip });
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // Save/Update crontab
  app.post('/save', strictLimiter, async (req, res) => {
    try {
      // Validate inputs
      const name = validateAndSanitize(req.body.name, 'name');
      const command = validateAndSanitize(req.body.command, 'command');
      const schedule = validateAndSanitize(req.body.schedule, 'schedule');
      
      if (!command) {
        logSecurityEvent('invalid_command_rejected', {
          ip: req.ip,
          command: req.body.command
        });
        return res.status(400).json({ error: 'Invalid or potentially dangerous command detected' });
      }
      
      if (!schedule) {
        return res.status(400).json({ error: 'Invalid schedule format' });
      }
      
      if (name && name.length > 100) {
        return res.status(400).json({ error: 'Job name too long' });
      }

      const jobData = {
        name: name || '',
        command,
        schedule,
        logging: req.body.logging === 'true' || req.body.logging === true,
        mailing: req.body.mailing || {}
      };

      if (req.body._id === -1 || req.body._id === '-1') {
        // New job
        const id = await db.createCrontab(jobData);
        logger.info('New crontab created', { id, name, command, ip: req.ip });
      } else {
        // Update existing job
        await db.updateCrontab(req.body._id, jobData);
        logger.info('Crontab updated', { id: req.body._id, name, command, ip: req.ip });
      }
      
      res.json({ success: true });
    } catch (error) {
      logError(error, { route: '/save', ip: req.ip, body: req.body });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Start/Stop job
  app.post('/start', strictLimiter, async (req, res) => {
    try {
      if (!req.body._id) {
        return res.status(400).json({ error: 'Job ID is required' });
      }
      
      await db.updateStatus(req.body._id, false);
      logger.info('Job started', { id: req.body._id, ip: req.ip });
      res.json({ success: true });
    } catch (error) {
      logError(error, { route: '/start', ip: req.ip });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/stop', strictLimiter, async (req, res) => {
    try {
      if (!req.body._id) {
        return res.status(400).json({ error: 'Job ID is required' });
      }
      
      await db.updateStatus(req.body._id, true);
      logger.info('Job stopped', { id: req.body._id, ip: req.ip });
      res.json({ success: true });
    } catch (error) {
      logError(error, { route: '/stop', ip: req.ip });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Remove job
  app.post('/remove', strictLimiter, async (req, res) => {
    try {
      if (!req.body._id) {
        return res.status(400).json({ error: 'Job ID is required' });
      }
      
      await db.deleteCrontab(req.body._id);
      logger.info('Job removed', { id: req.body._id, ip: req.ip });
      res.json({ success: true });
    } catch (error) {
      logError(error, { route: '/remove', ip: req.ip });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    const health = performanceMonitor.getHealthCheck();
    res.json(health);
  });

  // Metrics endpoint (if monitoring enabled)
  if (config.monitoring.enabled) {
    app.get('/metrics', (req, res) => {
      const metrics = performanceMonitor.getMetrics();
      res.json(metrics);
    });
  }

  // Error handling middleware
  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    
    logError(error, {
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (process.env.NODE_ENV === 'production') {
      res.status(statusCode).json({
        error: statusCode >= 500 ? 'Internal Server Error' : error.message
      });
    } else {
      res.status(statusCode).json({
        error: error.message,
        stack: error.stack
      });
    }
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // SSL configuration
  let server;
  if (config.ssl.enabled) {
    const credentials = {
      key: fs.readFileSync(config.ssl.key),
      cert: fs.readFileSync(config.ssl.cert)
    };
    
    if (config.ssl.ca) {
      credentials.ca = fs.readFileSync(config.ssl.ca);
    }
    
    server = https.createServer(credentials, app);
    logger.info('HTTPS server configured');
  } else {
    server = http.createServer(app);
  }

  // Server configuration for performance
  server.keepAliveTimeout = config.server.keepAliveTimeout;
  server.headersTimeout = config.server.headersTimeout;
  server.maxHeaderSize = config.server.maxHeaderSize;

  // Store server reference globally for graceful shutdown
  global.server = server;

  // Start server
  server.listen(config.server.port, config.server.host, () => {
    const protocol = config.ssl.enabled ? 'https' : 'http';
    logger.info(`Crontab UI v0.5.0 (Performance Enhanced) running at ${protocol}://${config.server.host}:${config.server.port}`);
    logger.info(`Node version: ${process.version}`);
    logger.info(`Process ID: ${process.pid}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    if (config.monitoring.enabled) {
      logger.info('Performance monitoring enabled');
    }
    
    if (config.cache.enabled) {
      logger.info(`Caching enabled (${config.cache.type})`);
    }
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);
    
    server.close(async () => {
      logger.info('HTTP server closed');
      
      try {
        await db.close();
        performanceMonitor.stop();
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
})().catch(error => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});

export default app;
