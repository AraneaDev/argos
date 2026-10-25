/**
 * Argos Health Check Script
 * 
 * This script performs comprehensive health checks on Argos
 * including connectivity, performance, and functionality tests.
 * 
 * Usage:
 *   node health-check-script.js [--config=/path/to/config.ini] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { performance } = require('perf_hooks');

// Configuration
const CONFIG = {
  serverUrl: process.env.SQL_MCP_SERVER_URL || 'http://localhost:3001',
  configPath: process.env.CONFIG_PATH || './config.ini',
  timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 30000,
  verbose: process.argv.includes('--verbose') || process.env.VERBOSE === 'true',
  outputFormat: process.env.OUTPUT_FORMAT || 'console', // console, json, prometheus
  metricsPort: parseInt(process.env.METRICS_PORT) || 9102
};

// Health check results
const results = {
  timestamp: new Date().toISOString(),
  overall: 'unknown',
  checks: [],
  metrics: {},
  duration: 0
};

// Utility functions
function log(message, level = 'info') {
  if (CONFIG.verbose || level === 'error') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

function addCheck(name, status, message, duration = 0, details = {}) {
  results.checks.push({
    name,
    status, // 'pass', 'fail', 'warn'
    message,
    duration,
    details,
    timestamp: new Date().toISOString()
  });
  
  log(`${name}: ${status} - ${message} (${duration}ms)`, status === 'fail' ? 'error' : 'info');
}

function updateMetric(name, value, labels = {}) {
  results.metrics[name] = {
    value,
    labels,
    timestamp: new Date().toISOString()
  };
}

// Health check functions
async function checkServerReachability() {
  const startTime = performance.now();
  
  try {
    const response = await makeHttpRequest('/health', 'GET');
    const duration = performance.now() - startTime;
    
    if (response.statusCode === 200) {
      addCheck('server_reachability', 'pass', 'Server is reachable', duration);
      updateMetric('server_reachable', 1);
      return true;
    } else {
      addCheck('server_reachability', 'fail', `Server returned ${response.statusCode}`, duration);
      updateMetric('server_reachable', 0);
      return false;
    }
  } catch (error) {
    const duration = performance.now() - startTime;
    addCheck('server_reachability', 'fail', `Server unreachable: ${error.message}`, duration);
    updateMetric('server_reachable', 0);
    return false;
  }
}

async function checkMetricsEndpoint() {
  const startTime = performance.now();
  
  try {
    const response = await makeHttpRequest('/metrics', 'GET');
    const duration = performance.now() - startTime;
    
    if (response.statusCode === 200) {
      const metricsCount = response.body.split('\n').filter(line => 
        line.startsWith('argos_') && !line.startsWith('#')
      ).length;
      
      addCheck('metrics_endpoint', 'pass', `Metrics endpoint active (${metricsCount} metrics)`, duration, {
        metricsCount
      });
      updateMetric('metrics_endpoint_available', 1);
      updateMetric('metrics_count', metricsCount);
      return true;
    } else {
      addCheck('metrics_endpoint', 'warn', `Metrics endpoint returned ${response.statusCode}`, duration);
      updateMetric('metrics_endpoint_available', 0);
      return false;
    }
  } catch (error) {
    const duration = performance.now() - startTime;
    addCheck('metrics_endpoint', 'warn', `Metrics endpoint unavailable: ${error.message}`, duration);
    updateMetric('metrics_endpoint_available', 0);
    return false;
  }
}

async function checkConfigFile() {
  const startTime = performance.now();
  
  try {
    if (!fs.existsSync(CONFIG.configPath)) {
      addCheck('config_file', 'fail', `Config file not found: ${CONFIG.configPath}`, 0);
      updateMetric('config_file_valid', 0);
      return false;
    }
    
    const configContent = fs.readFileSync(CONFIG.configPath, 'utf8');
    const duration = performance.now() - startTime;
    
    // Basic validation - check for database sections
    const databaseSections = configContent.match(/\[database\..+\]/g) || [];
    
    if (databaseSections.length === 0) {
      addCheck('config_file', 'fail', 'No database configurations found in config file', duration);
      updateMetric('config_file_valid', 0);
      return false;
    }
    
    addCheck('config_file', 'pass', `Config file valid (${databaseSections.length} databases)`, duration, {
      databaseCount: databaseSections.length,
      configPath: CONFIG.configPath
    });
    updateMetric('config_file_valid', 1);
    updateMetric('configured_databases', databaseSections.length);
    return true;
    
  } catch (error) {
    const duration = performance.now() - startTime;
    addCheck('config_file', 'fail', `Error reading config file: ${error.message}`, duration);
    updateMetric('config_file_valid', 0);
    return false;
  }
}

async function checkDatabaseConnections() {
  const startTime = performance.now();
  
  try {
    const response = await makeHttpRequest('/api/databases', 'GET');
    const duration = performance.now() - startTime;
    
    if (response.statusCode !== 200) {
      addCheck('database_connections', 'fail', `API returned ${response.statusCode}`, duration);
      updateMetric('database_connections_healthy', 0);
      return false;
    }
    
    const databases = JSON.parse(response.body);
    let healthyCount = 0;
    let totalCount = databases.length;
    
    for (const db of databases) {
      if (db.status === 'connected' || db.schema_cached) {
        healthyCount++;
      }
    }
    
    const healthRatio = totalCount > 0 ? healthyCount / totalCount : 0;
    
    if (healthRatio >= 0.8) {
      addCheck('database_connections', 'pass', 
        `${healthyCount}/${totalCount} databases healthy`, duration, {
        healthy: healthyCount,
        total: totalCount,
        healthRatio
      });
    } else if (healthRatio >= 0.5) {
      addCheck('database_connections', 'warn', 
        `${healthyCount}/${totalCount} databases healthy (below optimal)`, duration, {
        healthy: healthyCount,
        total: totalCount,
        healthRatio
      });
    } else {
      addCheck('database_connections', 'fail', 
        `${healthyCount}/${totalCount} databases healthy (critical)`, duration, {
        healthy: healthyCount,
        total: totalCount,
        healthRatio
      });
    }
    
    updateMetric('database_connections_healthy', healthyCount);
    updateMetric('database_connections_total', totalCount);
    return healthRatio >= 0.5;
    
  } catch (error) {
    const duration = performance.now() - startTime;
    addCheck('database_connections', 'fail', `Error checking databases: ${error.message}`, duration);
    updateMetric('database_connections_healthy', 0);
    return false;
  }
}

async function checkQueryPerformance() {
  const startTime = performance.now();
  
  try {
    // Test a simple query if we can identify a database
    const dbResponse = await makeHttpRequest('/api/databases', 'GET');
    if (dbResponse.statusCode !== 200) {
      addCheck('query_performance', 'warn', 'Cannot test queries - database API unavailable', 0);
      return false;
    }
    
    const databases = JSON.parse(dbResponse.body);
    if (databases.length === 0) {
      addCheck('query_performance', 'warn', 'No databases available for query testing', 0);
      return false;
    }
    
    // Try a simple query on the first available database
    const testDb = databases[0];
    const queryPayload = {
      database: testDb.name,
      query: 'SELECT 1 as test_value',
      params: []
    };
    
    const queryStartTime = performance.now();
    const response = await makeHttpRequest('/api/query', 'POST', JSON.stringify(queryPayload));
    const queryDuration = performance.now() - queryStartTime;
    const totalDuration = performance.now() - startTime;
    
    if (response.statusCode === 200) {
      const result = JSON.parse(response.body);
      
      if (queryDuration < 1000) { // Less than 1 second
        addCheck('query_performance', 'pass', 
          `Test query executed successfully in ${queryDuration.toFixed(2)}ms`, totalDuration, {
          queryDuration,
          database: testDb.name
        });
      } else {
        addCheck('query_performance', 'warn', 
          `Test query slow: ${queryDuration.toFixed(2)}ms`, totalDuration, {
          queryDuration,
          database: testDb.name
        });
      }
      
      updateMetric('test_query_duration_ms', queryDuration);
      updateMetric('test_query_success', 1);
      return true;
    } else {
      addCheck('query_performance', 'fail', 
        `Test query failed with status ${response.statusCode}`, totalDuration);
      updateMetric('test_query_success', 0);
      return false;
    }
    
  } catch (error) {
    const duration = performance.now() - startTime;
    addCheck('query_performance', 'fail', `Query performance test failed: ${error.message}`, duration);
    updateMetric('test_query_success', 0);
    return false;
  }
}

async function checkSystemResources() {
  const startTime = performance.now();
  
  try {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const duration = performance.now() - startTime;
    
    // Memory check (in MB)
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
    const memoryUtilization = (heapUsedMB / heapTotalMB) * 100;
    
    let memoryStatus = 'pass';
    let memoryMessage = `Memory usage: ${heapUsedMB.toFixed(2)}MB/${heapTotalMB.toFixed(2)}MB (${memoryUtilization.toFixed(1)}%)`;
    
    if (memoryUtilization > 90) {
      memoryStatus = 'fail';
      memoryMessage += ' - Critical';
    } else if (memoryUtilization > 75) {
      memoryStatus = 'warn';
      memoryMessage += ' - High';
    }
    
    addCheck('system_resources', memoryStatus, memoryMessage, duration, {
      memoryUsage: memoryUsage,
      memoryUtilization,
      cpuUsage
    });
    
    updateMetric('memory_heap_used_mb', heapUsedMB);
    updateMetric('memory_heap_total_mb', heapTotalMB);
    updateMetric('memory_utilization_percent', memoryUtilization);
    
    return memoryStatus !== 'fail';
    
  } catch (error) {
    const duration = performance.now() - startTime;
    addCheck('system_resources', 'fail', `Error checking system resources: ${error.message}`, duration);
    return false;
  }
}

// HTTP request helper
function makeHttpRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.serverUrl + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      timeout: CONFIG.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SQL-MCP-Health-Check/1.0'
      }
    };
    
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    
    const req = http.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.abort();
      reject(new Error('Request timeout'));
    });
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Output formatters
function outputConsole() {
  console.log('\n=== Argos Health Check Results ===\n');
  
  console.log(`Overall Status: ${results.overall.toUpperCase()}`);
  console.log(`Check Duration: ${results.duration.toFixed(2)}ms`);
  console.log(`Timestamp: ${results.timestamp}\n`);
  
  console.log('Individual Checks:');
  results.checks.forEach(check => {
    const statusIcon = check.status === 'pass' ? '[OK]' :
                      check.status === 'warn' ? '[WARN]' : '[ERROR]';
    console.log(`  ${statusIcon} ${check.name}: ${check.message}`);
    if (CONFIG.verbose && check.details && Object.keys(check.details).length > 0) {
      console.log(`     Details: ${JSON.stringify(check.details)}`);
    }
  });
  
  console.log('\nKey Metrics:');
  Object.entries(results.metrics).forEach(([name, metric]) => {
    console.log(`  ${name}: ${metric.value}`);
  });
}

function outputJson() {
  console.log(JSON.stringify(results, null, 2));
}

function outputPrometheus() {
  console.log('# Argos Health Check Metrics');
  console.log(`# Generated at ${results.timestamp}`);
  console.log();
  
  // Overall health
  const overallHealthValue = results.overall === 'pass' ? 1 : 
                            results.overall === 'warn' ? 0.5 : 0;
  console.log(`argos_health_check_overall{status="${results.overall}"} ${overallHealthValue}`);
  
  // Individual check results
  results.checks.forEach(check => {
    const checkValue = check.status === 'pass' ? 1 : 
                      check.status === 'warn' ? 0.5 : 0;
    console.log(`argos_health_check{check="${check.name}",status="${check.status}"} ${checkValue}`);
    console.log(`argos_health_check_duration_ms{check="${check.name}"} ${check.duration}`);
  });
  
  // Metrics
  Object.entries(results.metrics).forEach(([name, metric]) => {
    const labels = Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',');
    const labelsStr = labels ? `{${labels}}` : '';
    console.log(`argos_health_${name}${labelsStr} ${metric.value}`);
  });
  
  console.log(`argos_health_check_duration_total_ms ${results.duration}`);
}

// Main health check function
async function runHealthChecks() {
  const overallStartTime = performance.now();
  
  log('Starting Argos health checks...');
  
  // Run all health checks
  const checks = [
    checkServerReachability(),
    checkConfigFile(),
    checkMetricsEndpoint(),
    checkDatabaseConnections(),
    checkQueryPerformance(),
    checkSystemResources()
  ];
  
  await Promise.all(checks);
  
  // Calculate overall status
  const failCount = results.checks.filter(c => c.status === 'fail').length;
  const warnCount = results.checks.filter(c => c.status === 'warn').length;
  
  if (failCount === 0 && warnCount === 0) {
    results.overall = 'pass';
  } else if (failCount === 0) {
    results.overall = 'warn';
  } else {
    results.overall = 'fail';
  }
  
  results.duration = performance.now() - overallStartTime;
  
  log(`Health checks completed. Overall status: ${results.overall}`);
  
  // Output results
  switch (CONFIG.outputFormat) {
    case 'json':
      outputJson();
      break;
    case 'prometheus':
      outputPrometheus();
      break;
    default:
      outputConsole();
      break;
  }
  
  // Exit with appropriate code
  process.exit(results.overall === 'fail' ? 1 : 0);
}

// Handle command line arguments
if (process.argv.includes('--config')) {
  const configIndex = process.argv.indexOf('--config');
  if (configIndex + 1 < process.argv.length) {
    CONFIG.configPath = process.argv[configIndex + 1];
  }
}

if (process.argv.includes('--help')) {
  console.log(`
Argos Health Check Script

Usage: node health-check-script.js [options]

Options:
  --config <path>     Path to config.ini file (default: ./config.ini)
  --verbose           Enable verbose output
  --help              Show this help message

Environment Variables:
  SQL_MCP_SERVER_URL  Server URL (default: http://localhost:3001)
  CONFIG_PATH         Config file path (default: ./config.ini)
  HEALTH_CHECK_TIMEOUT Timeout in ms (default: 30000)
  OUTPUT_FORMAT       Output format: console, json, prometheus (default: console)
  VERBOSE             Enable verbose output (true/false)
  METRICS_PORT        Port for metrics server (default: 9102)

Exit Codes:
  0 - All checks passed or only warnings
  1 - One or more checks failed
`);
  process.exit(0);
}

// Run the health checks
runHealthChecks().catch(error => {
  console.error('Fatal error during health checks:', error);
  process.exit(1);
});