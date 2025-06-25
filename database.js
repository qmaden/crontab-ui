import Database from 'better-sqlite3';
import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';

class DatabaseManager {
  constructor() {
    this.type = config.database.type;
    this.cache = new Map();
    this.cacheEnabled = config.cache.enabled;
    this.cacheTTL = config.cache.ttl * 1000; // Convert to milliseconds
    this.initialized = false;
  }

  async initialize() {
    try {
      if (this.type === 'sqlite') {
        await this.initializeSQLite();
      } else if (this.type === 'redis') {
        await this.initializeRedis();
      }
      this.initialized = true;
      logger.info(`Database initialized: ${this.type}`);
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  async initializeSQLite() {
    // Ensure database directory exists
    const dbDir = path.dirname(config.database.sqlite.filename);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.database.sqlite.filename, config.database.sqlite.options);
    
    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = memory');
    this.db.pragma('mmap_size = 268435456'); // 256MB

    // Create tables if they don't exist
    this.createTables();
    
    // Prepare statements for better performance
    this.prepareStatements();
  }

  async initializeRedis() {
    this.redis = new Redis(config.database.redis);
    
    this.redis.on('connect', () => {
      logger.info('Redis connected');
    });

    this.redis.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    await this.redis.ping();
  }

  createTables() {
    const createCrontabTable = `
      CREATE TABLE IF NOT EXISTS crontabs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        _id TEXT UNIQUE NOT NULL,
        name TEXT,
        command TEXT NOT NULL,
        schedule TEXT NOT NULL,
        stopped INTEGER DEFAULT 0,
        logging INTEGER DEFAULT 0,
        mailing TEXT DEFAULT '{}',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        created INTEGER,
        saved INTEGER DEFAULT 0,
        last_run DATETIME,
        run_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0
      )
    `;

    const createEnvTable = `
      CREATE TABLE IF NOT EXISTS environment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createLogsTable = `
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'stdout', 'stderr', 'info', 'error'
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES crontabs(_id)
      )
    `;

    const createBackupsTable = `
      CREATE TABLE IF NOT EXISTS backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        description TEXT
      )
    `;

    this.db.exec(createCrontabTable);
    this.db.exec(createEnvTable);
    this.db.exec(createLogsTable);
    this.db.exec(createBackupsTable);

    // Create indexes for better performance
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_crontabs_id ON crontabs(_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_crontabs_schedule ON crontabs(schedule)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_logs_job_id ON logs(job_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)');
  }

  prepareStatements() {
    if (this.type !== 'sqlite') return;

    this.statements = {
      insertCrontab: this.db.prepare(`
        INSERT INTO crontabs (_id, name, command, schedule, stopped, logging, mailing, created, saved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateCrontab: this.db.prepare(`
        UPDATE crontabs SET name = ?, command = ?, schedule = ?, logging = ?, mailing = ?, saved = 0, timestamp = CURRENT_TIMESTAMP
        WHERE _id = ?
      `),
      getCrontab: this.db.prepare('SELECT * FROM crontabs WHERE _id = ?'),
      getAllCrontabs: this.db.prepare('SELECT * FROM crontabs ORDER BY created DESC'),
      deleteCrontab: this.db.prepare('DELETE FROM crontabs WHERE _id = ?'),
      updateStatus: this.db.prepare('UPDATE crontabs SET stopped = ?, saved = 0 WHERE _id = ?'),
      updateSaved: this.db.prepare('UPDATE crontabs SET saved = 1 WHERE _id = ?'),
      insertLog: this.db.prepare('INSERT INTO logs (job_id, type, message) VALUES (?, ?, ?)'),
      getLogs: this.db.prepare('SELECT * FROM logs WHERE job_id = ? ORDER BY timestamp DESC LIMIT ?'),
      insertBackup: this.db.prepare('INSERT INTO backups (filename, size, description) VALUES (?, ?, ?)'),
      getBackups: this.db.prepare('SELECT * FROM backups ORDER BY created_at DESC'),
      deleteBackup: this.db.prepare('DELETE FROM backups WHERE filename = ?'),
    };
  }

  // Cache management
  getCacheKey(operation, params) {
    return `${operation}:${JSON.stringify(params)}`;
  }

  setCache(key, value) {
    if (!this.cacheEnabled) return;
    
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });

    // Clean old cache entries
    if (this.cache.size > config.cache.maxEntries) {
      const oldest = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      this.cache.delete(oldest[0]);
    }
  }

  getCache(key) {
    if (!this.cacheEnabled) return null;
    
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.value;
  }

  clearCache(pattern = null) {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  // CRUD operations
  async createCrontab(data) {
    const id = this.generateId();
    const cacheKey = this.getCacheKey('getAllCrontabs', {});
    
    try {
      if (this.type === 'sqlite') {
        this.statements.insertCrontab.run(
          id, data.name, data.command, data.schedule,
          data.stopped ? 1 : 0, data.logging ? 1 : 0,
          JSON.stringify(data.mailing || {}), data.created || Date.now(), 0
        );
      } else if (this.type === 'redis') {
        const crontab = { ...data, _id: id, created: Date.now(), saved: false };
        await this.redis.hset('crontabs', id, JSON.stringify(crontab));
      }

      this.clearCache('getAllCrontabs');
      logger.info(`Crontab created: ${id}`);
      return id;
    } catch (error) {
      logger.error('Error creating crontab:', error);
      throw error;
    }
  }

  async updateCrontab(id, data) {
    try {
      if (this.type === 'sqlite') {
        this.statements.updateCrontab.run(
          data.name, data.command, data.schedule,
          data.logging ? 1 : 0, JSON.stringify(data.mailing || {}), id
        );
      } else if (this.type === 'redis') {
        const existing = await this.getCrontab(id);
        if (existing) {
          const updated = { ...existing, ...data, saved: false };
          await this.redis.hset('crontabs', id, JSON.stringify(updated));
        }
      }

      this.clearCache();
      logger.info(`Crontab updated: ${id}`);
    } catch (error) {
      logger.error('Error updating crontab:', error);
      throw error;
    }
  }

  async getCrontab(id) {
    const cacheKey = this.getCacheKey('getCrontab', { id });
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      let result;
      if (this.type === 'sqlite') {
        result = this.statements.getCrontab.get(id);
        if (result) {
          result.mailing = JSON.parse(result.mailing || '{}');
          result.stopped = !!result.stopped;
          result.logging = !!result.logging;
          result.saved = !!result.saved;
        }
      } else if (this.type === 'redis') {
        const data = await this.redis.hget('crontabs', id);
        result = data ? JSON.parse(data) : null;
      }

      if (result) {
        this.setCache(cacheKey, result);
      }
      return result;
    } catch (error) {
      logger.error('Error getting crontab:', error);
      throw error;
    }
  }

  async getAllCrontabs() {
    const cacheKey = this.getCacheKey('getAllCrontabs', {});
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      let results;
      if (this.type === 'sqlite') {
        results = this.statements.getAllCrontabs.all();
        results = results.map(row => ({
          ...row,
          mailing: JSON.parse(row.mailing || '{}'),
          stopped: !!row.stopped,
          logging: !!row.logging,
          saved: !!row.saved,
        }));
      } else if (this.type === 'redis') {
        const all = await this.redis.hgetall('crontabs');
        results = Object.values(all).map(data => JSON.parse(data));
        results.sort((a, b) => (b.created || 0) - (a.created || 0));
      }

      this.setCache(cacheKey, results);
      return results || [];
    } catch (error) {
      logger.error('Error getting all crontabs:', error);
      throw error;
    }
  }

  async deleteCrontab(id) {
    try {
      if (this.type === 'sqlite') {
        this.statements.deleteCrontab.run(id);
      } else if (this.type === 'redis') {
        await this.redis.hdel('crontabs', id);
      }

      this.clearCache();
      logger.info(`Crontab deleted: ${id}`);
    } catch (error) {
      logger.error('Error deleting crontab:', error);
      throw error;
    }
  }

  async updateStatus(id, stopped) {
    try {
      if (this.type === 'sqlite') {
        this.statements.updateStatus.run(stopped ? 1 : 0, id);
      } else if (this.type === 'redis') {
        const existing = await this.getCrontab(id);
        if (existing) {
          existing.stopped = stopped;
          existing.saved = false;
          await this.redis.hset('crontabs', id, JSON.stringify(existing));
        }
      }

      this.clearCache();
      logger.info(`Crontab status updated: ${id} -> ${stopped ? 'stopped' : 'started'}`);
    } catch (error) {
      logger.error('Error updating status:', error);
      throw error;
    }
  }

  // Utility methods
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async getStats() {
    try {
      const crontabs = await this.getAllCrontabs();
      return {
        total: crontabs.length,
        active: crontabs.filter(c => !c.stopped).length,
        inactive: crontabs.filter(c => c.stopped).length,
        saved: crontabs.filter(c => c.saved).length,
        unsaved: crontabs.filter(c => !c.saved).length,
      };
    } catch (error) {
      logger.error('Error getting stats:', error);
      return { total: 0, active: 0, inactive: 0, saved: 0, unsaved: 0 };
    }
  }

  async close() {
    if (this.type === 'sqlite' && this.db) {
      this.db.close();
    } else if (this.type === 'redis' && this.redis) {
      await this.redis.quit();
    }
    this.cache.clear();
    logger.info('Database connection closed');
  }
}

export const db = new DatabaseManager();
export default db;
