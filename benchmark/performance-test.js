#!/usr/bin/env node

/**
 * Performance Benchmark for Crontab UI
 * Tests various endpoints and measures performance metrics
 */

import http from 'http';
import https from 'https';
import { performance } from 'perf_hooks';
import cluster from 'cluster';
import os from 'os';

class PerformanceBenchmark {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 8000;
    this.protocol = options.protocol || 'http';
    this.auth = options.auth || 'admin:changeme';
    this.concurrency = options.concurrency || 10;
    this.requests = options.requests || 1000;
    this.results = [];
  }

  async run() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   🚀 PERFORMANCE BENCHMARK                   ║
╠══════════════════════════════════════════════════════════════╣
║  Target: ${this.protocol}://${this.host}:${this.port}                              ║
║  Concurrency: ${this.concurrency.toString().padEnd(10)} Requests: ${this.requests.toString().padEnd(10)}           ║
║  CPU Cores: ${os.cpus().length.toString().padEnd(12)} Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB               ║
╚══════════════════════════════════════════════════════════════╝
`);

    const tests = [
      { name: 'Health Check', path: '/health', method: 'GET' },
      { name: 'Dashboard Load', path: '/', method: 'GET' },
      { name: 'Create Crontab', path: '/save', method: 'POST', data: {
        _id: -1,
        name: 'benchmark-test',
        command: 'echo "benchmark test"',
        schedule: '0 0 * * *',
        logging: false
      }},
      { name: 'List Crontabs', path: '/', method: 'GET' },
      { name: 'Metrics Endpoint', path: '/metrics', method: 'GET' }
    ];

    for (const test of tests) {
      console.log(`\n🔄 Running: ${test.name}`);
      const result = await this.runTest(test);
      this.results.push({ test: test.name, ...result });
      this.printResult(test.name, result);
    }

    this.printSummary();
  }

  async runTest(test) {
    const startTime = performance.now();
    const promises = [];
    const results = {
      successful: 0,
      failed: 0,
      times: [],
      errors: []
    };

    // Create batches to control concurrency
    const batchSize = this.concurrency;
    const batches = Math.ceil(this.requests / batchSize);

    for (let batch = 0; batch < batches; batch++) {
      const batchPromises = [];
      const requestsInBatch = Math.min(batchSize, this.requests - (batch * batchSize));

      for (let i = 0; i < requestsInBatch; i++) {
        batchPromises.push(this.makeRequest(test));
      }

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.successful++;
          results.times.push(result.value.duration);
        } else {
          results.failed++;
          results.errors.push(result.reason?.message || 'Unknown error');
        }
      });

      // Small delay between batches to prevent overwhelming
      if (batch < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    const totalTime = performance.now() - startTime;
    
    // Calculate statistics
    results.times.sort((a, b) => a - b);
    const count = results.times.length;
    
    return {
      totalTime,
      requestsPerSecond: (this.requests / totalTime) * 1000,
      successful: results.successful,
      failed: results.failed,
      avgResponseTime: count > 0 ? results.times.reduce((a, b) => a + b, 0) / count : 0,
      minResponseTime: count > 0 ? results.times[0] : 0,
      maxResponseTime: count > 0 ? results.times[count - 1] : 0,
      p50: count > 0 ? results.times[Math.floor(count * 0.5)] : 0,
      p95: count > 0 ? results.times[Math.floor(count * 0.95)] : 0,
      p99: count > 0 ? results.times[Math.floor(count * 0.99)] : 0,
      errors: results.errors.slice(0, 5) // First 5 errors
    };
  }

  makeRequest(test) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      
      const options = {
        hostname: this.host,
        port: this.port,
        path: test.path,
        method: test.method,
        headers: {
          'Authorization': 'Basic ' + Buffer.from(this.auth).toString('base64'),
          'Content-Type': 'application/json',
          'User-Agent': 'CrontabUI-Benchmark/1.0'
        }
      };

      const client = this.protocol === 'https' ? https : http;
      
      const req = client.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          const duration = performance.now() - startTime;
          
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve({ duration, statusCode: res.statusCode, data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (test.data) {
        req.write(JSON.stringify(test.data));
      }
      
      req.end();
    });
  }

  printResult(testName, result) {
    console.log(`   ✅ ${result.successful} successful, ❌ ${result.failed} failed`);
    console.log(`   📊 ${result.requestsPerSecond.toFixed(2)} req/s, avg: ${result.avgResponseTime.toFixed(2)}ms`);
    console.log(`   ⏱️  min: ${result.minResponseTime.toFixed(2)}ms, max: ${result.maxResponseTime.toFixed(2)}ms`);
    console.log(`   📈 p50: ${result.p50.toFixed(2)}ms, p95: ${result.p95.toFixed(2)}ms, p99: ${result.p99.toFixed(2)}ms`);
    
    if (result.errors.length > 0) {
      console.log(`   ⚠️  Sample errors: ${result.errors.slice(0, 3).join(', ')}`);
    }
  }

  printSummary() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      📊 BENCHMARK SUMMARY                    ║
╚══════════════════════════════════════════════════════════════╝
`);

    const totalSuccessful = this.results.reduce((sum, r) => sum + r.successful, 0);
    const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
    const avgRps = this.results.reduce((sum, r) => sum + r.requestsPerSecond, 0) / this.results.length;
    const avgResponseTime = this.results.reduce((sum, r) => sum + r.avgResponseTime, 0) / this.results.length;

    console.log(`📈 Overall Performance:`);
    console.log(`   • Total Requests: ${totalSuccessful + totalFailed}`);
    console.log(`   • Success Rate: ${((totalSuccessful / (totalSuccessful + totalFailed)) * 100).toFixed(2)}%`);
    console.log(`   • Average RPS: ${avgRps.toFixed(2)} requests/second`);
    console.log(`   • Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
    
    console.log(`\n🏆 Best Performing Tests:`);
    const sorted = [...this.results].sort((a, b) => b.requestsPerSecond - a.requestsPerSecond);
    sorted.slice(0, 3).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.test}: ${result.requestsPerSecond.toFixed(2)} req/s`);
    });

    // Performance rating
    let rating = 'Poor';
    if (avgRps > 1000) rating = 'Excellent';
    else if (avgRps > 500) rating = 'Good';
    else if (avgRps > 200) rating = 'Fair';

    console.log(`\n🎯 Performance Rating: ${rating}`);
    
    if (avgRps < 100) {
      console.log(`\n💡 Recommendations:`);
      console.log(`   • Enable clustering with ENABLE_CLUSTER=true`);
      console.log(`   • Enable compression and caching`);
      console.log(`   • Consider using Redis for database`);
      console.log(`   • Optimize Node.js with --max-old-space-size`);
    }

    console.log(`\n🔧 System Information:`);
    console.log(`   • Node.js: ${process.version}`);
    console.log(`   • Platform: ${process.platform} ${process.arch}`);
    console.log(`   • CPU Cores: ${os.cpus().length}`);
    console.log(`   • Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used / ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB total`);
  }
}

// CLI interface
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace(/^--/, '');
  const value = args[i + 1];
  
  if (key && value) {
    if (['port', 'concurrency', 'requests'].includes(key)) {
      options[key] = parseInt(value);
    } else {
      options[key] = value;
    }
  }
}

// Default values from environment
options.host = options.host || process.env.HOST || 'localhost';
options.port = options.port || parseInt(process.env.PORT) || 8000;
options.requests = options.requests || parseInt(process.env.BENCHMARK_REQUESTS) || 1000;
options.concurrency = options.concurrency || parseInt(process.env.BENCHMARK_CONCURRENCY) || 10;

// Run benchmark
const benchmark = new PerformanceBenchmark(options);

benchmark.run().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});

export default PerformanceBenchmark;
