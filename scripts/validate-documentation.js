#!/usr/bin/env node

/**
 * Documentation Validation Script
 * 
 * This script validates that documented features have corresponding implementations
 * and checks for version consistency across files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.dirname(__dirname);

// Color codes for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

/**
 * Main validation function
 */
async function validateDocumentation() {
  console.log(`${colors.blue}[SEARCH] Documentation Validation Starting...${colors.reset}\n`);

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0
  };

  // Test 1: Version Consistency
  console.log('[LIST] Checking version consistency...');
  await checkVersionConsistency(results);

  // Test 2: Setup Script Features
  console.log('\n[LIST] Validating setup script features...');
  await validateSetupFeatures(results);

  // Test 3: MCP Tools Documentation
  console.log('\n[LIST] Validating MCP tools documentation...');
  await validateMCPTools(results);

  // Test 4: Configuration Examples
  console.log('\n[LIST] Validating configuration examples...');
  await validateConfigurationExamples(results);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`${colors.blue}[STATS] Validation Summary:${colors.reset}`);
  console.log(`  [OK] Passed: ${colors.green}${results.passed}${colors.reset}`);
  console.log(`  [FAIL] Failed: ${colors.red}${results.failed}${colors.reset}`);
  console.log(`  [WARN]  Warnings: ${colors.yellow}${results.warnings}${colors.reset}`);
  
  if (results.failed === 0) {
    console.log(`\n${colors.green} All validation checks passed!${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}[FAIL] ${results.failed} validation check(s) failed.${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Check version consistency across files
 */
async function checkVersionConsistency(results) {
  try {
    // Read package.json version
    const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const expectedVersion = packageJson.version;
    
    console.log(`  [PKG] Package version: ${expectedVersion}`);

    // Check files that should contain version references.
    // The README deliberately is not one of them: its title carries no version, matching the
    // sibling MCP repos, and the live Release badge reports the released version instead of a
    // hand-maintained string that can drift.
    const filesToCheck = [
      { file: 'src/types/index.ts', pattern: /SERVER_VERSION = '([^']+)'/g, name: 'SERVER_VERSION' },
      { file: 'docs/api/typescript-api.md', pattern: /as of v([0-9]+\.[0-9]+\.[0-9]+)\.?\s/g, name: 'TypeScript API docs' },
      { file: 'docs/tutorials/01-installation.md', pattern: /Argos v([0-9.]+)/g, name: 'Installation tutorial' }
    ];

    for (const { file, pattern, name } of filesToCheck) {
      const filePath = path.join(PROJECT_ROOT, file);
      
      if (!fs.existsSync(filePath)) {
        console.log(`  [WARN]  File not found: ${file}`);
        results.warnings++;
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const matches = [...content.matchAll(pattern)];
      
      if (matches.length === 0) {
        console.log(`  [FAIL] No version found in ${name}`);
        results.failed++;
      } else {
        const foundVersion = matches[0][1];
        if (foundVersion === expectedVersion) {
          console.log(`  [OK] ${name}: ${foundVersion}`);
          results.passed++;
        } else {
          console.log(`  [FAIL] ${name}: Expected ${expectedVersion}, found ${foundVersion}`);
          results.failed++;
        }
      }
    }
  } catch (error) {
    console.log(`  [FAIL] Error checking version consistency: ${error.message}`);
    results.failed++;
  }
}

/**
 * Validate setup script features
 */
async function validateSetupFeatures(results) {
  try {
    // Check if setup script exists and is buildable
    const setupPath = path.join(PROJECT_ROOT, 'src/setup.ts');
    const distSetupPath = path.join(PROJECT_ROOT, 'dist/setup.js');
    
    if (!fs.existsSync(setupPath)) {
      console.log('  [FAIL] Setup script source not found');
      results.failed++;
      return;
    }
    
    if (!fs.existsSync(distSetupPath)) {
      console.log('  [FAIL] Setup script not built (run npm run build)');
      results.failed++;
      return;
    }
    
    console.log('  [OK] Setup script exists and is built');
    results.passed++;
    
    // Check if setup UI has been cleaned up (should not have excessive debug output)
    const setupUIPath = path.join(PROJECT_ROOT, 'src/utils/setup-ui.ts');
    if (fs.existsSync(setupUIPath)) {
      const content = fs.readFileSync(setupUIPath, 'utf8');
      
      // Check that debug output is conditional
      if (content.includes('process.env.DEBUG_SETUP')) {
        console.log('  [OK] Setup UI has conditional debug output');
        results.passed++;
      } else {
        console.log('  [WARN]  Setup UI might have unconditional debug output');
        results.warnings++;
      }
    }
  } catch (error) {
    console.log(`  [FAIL] Error validating setup features: ${error.message}`);
    results.failed++;
  }
}

/**
 * Validate MCP tools documentation
 */
async function validateMCPTools(results) {
  try {
    const toolsDocPath = path.join(PROJECT_ROOT, 'docs/api/mcp-tools-reference.md');
    
    if (!fs.existsSync(toolsDocPath)) {
      console.log('  [FAIL] MCP tools reference documentation not found');
      results.failed++;
      return;
    }
    
    const content = fs.readFileSync(toolsDocPath, 'utf8');
    
    // Check for implementation status labels
    if (content.includes('[WIP] **Basic Implementation**')) {
      console.log('  [OK] Contains implementation status indicators');
      results.passed++;
    } else {
      console.log('  [WARN]  Missing implementation status indicators');
      results.warnings++;
    }
    
    // Check for proper caveats about planned features
    if (content.includes('planned for future releases')) {
      console.log('  [OK] Contains appropriate future feature caveats');
      results.passed++;
    } else {
      console.log('  [WARN]  Missing future feature caveats');
      results.warnings++;
    }
    
    // Ensure it doesn't claim non-existent advanced features
    const problematicClaims = [
      'Advanced index suggestions',
      'detailed complexity scoring',
      'comprehensive optimization analysis'
    ];
    
    let hasProblematicClaims = false;
    for (const claim of problematicClaims) {
      if (content.includes(claim)) {
        console.log(`  [FAIL] Contains unimplemented feature claim: "${claim}"`);
        results.failed++;
        hasProblematicClaims = true;
      }
    }
    
    if (!hasProblematicClaims) {
      console.log('  [OK] No unimplemented feature claims found');
      results.passed++;
    }
    
  } catch (error) {
    console.log(`  [FAIL] Error validating MCP tools documentation: ${error.message}`);
    results.failed++;
  }
}

/**
 * Validate configuration examples
 */
async function validateConfigurationExamples(results) {
  try {
    const configDocPath = path.join(PROJECT_ROOT, 'docs/guides/configuration-guide.md');
    
    if (!fs.existsSync(configDocPath)) {
      console.log('  [FAIL] Configuration guide not found');
      results.failed++;
      return;
    }
    
    const content = fs.readFileSync(configDocPath, 'utf8');
    
    // Check that unimplemented features are properly marked
    if (content.includes('Advanced Configuration (Planned Features)')) {
      console.log('  [OK] Unimplemented features properly marked as planned');
      results.passed++;
    } else {
      console.log('  [WARN]  Advanced features not properly marked as planned');
      results.warnings++;
    }
    
    // Ensure problematic command examples are removed
    const problematicCommands = [
      '--config-template',
      'sql-mcp-encrypt',
      'updateSecurityConfig',
      '--profile='
    ];
    
    let hasProblematicCommands = false;
    for (const command of problematicCommands) {
      if (content.includes(command) && !content.includes('planned for future')) {
        console.log(`  [FAIL] Contains unimplemented command: "${command}"`);
        results.failed++;
        hasProblematicCommands = true;
      }
    }
    
    if (!hasProblematicCommands) {
      console.log('  [OK] No unimplemented command examples found');
      results.passed++;
    }
    
  } catch (error) {
    console.log(`  [FAIL] Error validating configuration examples: ${error.message}`);
    results.failed++;
  }
}

// Run validation if this script is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateDocumentation().catch(error => {
    console.error(`${colors.red}[FAIL] Validation script failed: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}
