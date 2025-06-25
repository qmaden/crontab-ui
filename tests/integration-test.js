#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

let serverProcess = null;
const testPort = 8887;

console.log('🧪 Starting integration tests...\n');

// Test configuration
const baseUrl = `http://localhost:${testPort}`;
const testTimeout = 30000;
const authHeader = 'Basic ' + Buffer.from('admin:admin123').toString('base64');

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const startServer = () => {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting server...');
    
    serverProcess = spawn('node', ['server.js'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: testPort,
        NODE_ENV: 'test',
        CRON_DB_PATH: join(projectRoot, 'crontabs', 'test-cron.db'),
        LOG_LEVEL: 'error',
        BASIC_AUTH_USER: 'admin',
        BASIC_AUTH_PWD: 'admin123'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log('Server output:', text.trim());
    });

    serverProcess.stderr.on('data', (data) => {
      const text = data.toString();
      console.error('Server error:', text.trim());
    });

    serverProcess.on('error', reject);
    
    // Wait a bit then check if server is responding
    setTimeout(async () => {
      try {
        const response = await fetch(`${baseUrl}/health`, {
          headers: {
            'Authorization': 'Basic ' + Buffer.from('admin:admin123').toString('base64')
          }
        });
        if (response.status === 200) {
          resolve();
        } else {
          reject(new Error(`Server not responding: ${response.status}`));
        }
      } catch (error) {
        reject(new Error(`Server check failed: ${error.message}`));
      }
    }, 3000);
    
    // Timeout after 15 seconds
    setTimeout(() => reject(new Error('Server start timeout')), 15000);
  });
};

const stopServer = () => {
  if (serverProcess) {
    console.log('🛑 Stopping server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
};

// Test functions
const testHealthEndpoint = async () => {
  console.log('🏥 Testing health endpoint...');
  const response = await fetch(`${baseUrl}/health`, {
    headers: { 'Authorization': authHeader }
  });
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  
  if (data.status !== 'healthy' && data.status !== 'warning') {
    throw new Error(`Invalid health status: ${data.status}`);
  }
  
  console.log('✅ Health endpoint working');
};

const testMainPage = async () => {
  console.log('🏠 Testing main page...');
  const response = await fetch(baseUrl, {
    headers: { 'Authorization': authHeader }
  });
  
  if (response.status !== 200) {
    const errorText = await response.text();
    console.error('Error response:', errorText);
    throw new Error(`Main page failed: ${response.status}`);
  }
  
  const html = await response.text();
  
  if (!html.includes('Crontab UI') && !html.includes('crontab')) {
    throw new Error('Main page does not contain expected content');
  }
  
  console.log('✅ Main page working');
};

const testAPIEndpoints = async () => {
  console.log('🔌 Testing API endpoints...');
  
  // Test crontab list
  const listResponse = await fetch(`${baseUrl}/crontabs`, {
    headers: { 'Authorization': authHeader }
  });
  if (listResponse.status !== 200) {
    throw new Error(`Crontab list failed: ${listResponse.status}`);
  }
  
  // Test stats endpoint
  const statsResponse = await fetch(`${baseUrl}/stats`, {
    headers: { 'Authorization': authHeader }
  });
  if (statsResponse.status !== 200) {
    throw new Error(`Stats endpoint failed: ${statsResponse.status}`);
  }
  
  const stats = await statsResponse.json();
  if (typeof stats.totalJobs !== 'number') {
    throw new Error('Invalid stats response');
  }
  
  console.log('✅ API endpoints working');
};

const testCronOperations = async () => {
  console.log('⏰ Testing cron operations...');
  
  // Create a test cron job
  const testJob = {
    name: 'test-job',
    command: 'echo "test"',
    schedule: '0 0 * * *',
    logging: 'true',
    mailing: JSON.stringify({ onError: false, onSuccess: false })
  };
  
  const createResponse = await fetch(`${baseUrl}/save`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(testJob)
  });
  
  if (createResponse.status !== 200) {
    throw new Error(`Cron job creation failed: ${createResponse.status}`);
  }
  
  // List jobs to verify creation
  const listResponse = await fetch(`${baseUrl}/crontabs`, {
    headers: { 'Authorization': authHeader }
  });
  const jobs = await listResponse.json();
  
  const createdJob = jobs.find(job => job.name === 'test-job');
  if (!createdJob) {
    throw new Error('Created job not found in list');
  }
  
  console.log('✅ Cron operations working');
};

const testPerformanceEndpoints = async () => {
  console.log('📊 Testing performance endpoints...');
  
  const metricsResponse = await fetch(`${baseUrl}/metrics`, {
    headers: { 'Authorization': authHeader }
  });
  if (metricsResponse.status !== 200) {
    throw new Error(`Metrics endpoint failed: ${metricsResponse.status}`);
  }
  
  const metrics = await metricsResponse.json();
  if (!metrics.system || !metrics.process) {
    throw new Error('Invalid metrics response');
  }
  
  console.log('✅ Performance endpoints working');
};

// Main test runner
const runTests = async () => {
  try {
    await startServer();
    await sleep(2000); // Give server time to fully start
    
    await testHealthEndpoint();
    await testMainPage();
    await testAPIEndpoints();
    await testCronOperations();
    await testPerformanceEndpoints();
    
    console.log('\n🎉 All tests passed!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    stopServer();
  }
};

// Handle cleanup on exit
process.on('SIGINT', () => {
  stopServer();
  process.exit(1);
});

process.on('SIGTERM', () => {
  stopServer();
  process.exit(1);
});

// Run tests
runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  stopServer();
  process.exit(1);
});
