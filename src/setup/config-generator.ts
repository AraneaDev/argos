import { DatabaseType } from '../types/database.js';
import type {
  SetupConfig,
  DatabaseConfig,
  ExtensionConfig,
  SecurityConfig,
  GeneratedConfigFile,
  FieldRedactionRule,
} from '../types/config.js';

/**
 *
 */
export class ConfigGenerator {
  /**
   * Generate a configuration file string from config object
   */
  static generateConfigString(config: SetupConfig): string {
    let configString = '';

    // Add database sections
    for (const [key, value] of Object.entries(config)) {
      if (key.startsWith('database.')) {
        configString += `[${key}]\n`;
        const dbConfig = value as DatabaseConfig;

        for (const [prop, val] of Object.entries(dbConfig)) {
          if (
            val !== undefined &&
            val !== null &&
            prop !== 'redaction' &&
            prop !== 'mcp_configurable'
          ) {
            configString += `${prop}=${this.formatConfigValue(val)}\n`;
          }
        }

        // Write mcp_configurable flag explicitly
        if (dbConfig.mcp_configurable !== undefined) {
          configString += `mcp_configurable=${this.formatConfigValue(dbConfig.mcp_configurable)}\n`;
        }

        // Handle redaction configuration separately
        if (dbConfig.redaction?.enabled) {
          configString += 'redaction_enabled=true\n';

          if (dbConfig.redaction.rules.length > 0) {
            const rulesString = dbConfig.redaction.rules
              .map((rule: FieldRedactionRule) => {
                let ruleStr = `${rule.field_pattern}:${rule.redaction_type}`;
                if (
                  rule.replacement_text &&
                  (rule.redaction_type === 'replace' || rule.redaction_type === 'custom')
                ) {
                  ruleStr += `:${rule.replacement_text}`;
                }
                return ruleStr;
              })
              .join(',');
            configString += `redaction_rules=${rulesString}\n`;
          }

          if (dbConfig.redaction.default_redaction?.replacement_text) {
            configString += `redaction_replacement_text=${dbConfig.redaction.default_redaction.replacement_text}\n`;
          }

          if (dbConfig.redaction.log_redacted_access) {
            configString += 'redaction_log_access=true\n';
          }

          if (dbConfig.redaction.audit_redacted_queries) {
            configString += 'redaction_audit_queries=true\n';
          }

          if (dbConfig.redaction.case_sensitive_matching) {
            configString += 'redaction_case_sensitive=true\n';
          }
        }
        configString += '\n';
      }
    }

    // Add extension section
    const extensionConfig = config.extension as ExtensionConfig;
    if (extensionConfig) {
      configString += '[extension]\n';
      for (const [prop, val] of Object.entries(extensionConfig)) {
        if (val !== undefined && val !== null) {
          configString += `${prop}=${this.formatConfigValue(val)}\n`;
        }
      }
      configString += '\n';
    }

    // Add security section
    const securityConfig = config.security as SecurityConfig;
    if (securityConfig) {
      configString += '[security]\n';
      for (const [prop, val] of Object.entries(securityConfig)) {
        if (val !== undefined && val !== null) {
          configString += `${prop}=${this.formatConfigValue(val)}\n`;
        }
      }
      configString += '\n';
    }

    return configString;
  }

  /**
   * Generate a complete configuration file with metadata
   */
  static generateConfigFile(
    config: SetupConfig,
    metadata?: {
      version?: string;
      generated?: Date;
      description?: string;
    }
  ): GeneratedConfigFile {
    const now = new Date();
    const version = metadata?.version || '2.0.0';
    const description = metadata?.description || 'Argos Configuration';

    let content = '';

    // Add header comment
    content += `# ${description}\n`;
    content += `# Generated on: ${now.toISOString()}\n`;
    content += `# Version: ${version}\n`;
    content += '#\n';
    content += '# This configuration file defines database connections and settings\n';
    content += '# for Argos.\n';
    content += '#\n';
    content += '# Sections:\n';
    content += '# [database.*] - Database connection configurations\n';
    content += '# [extension] - Extension behavior settings\n';
    content += '# [security] - Query security and performance limits\n';
    content += '#\n\n';

    // Add configuration content
    content += this.generateConfigString(config);

    return {
      content,
      metadata: {
        version,
        generated: now,
        description,
        database_count: this.countDatabases(config),
        security_enabled: !!config.security,
        ssh_enabled: this.hasSSHEnabled(config),
        generated_at: now.toISOString(),
      },
    };
  }

  /**
   * Generate a sample configuration for documentation
   */
  static generateSampleConfig(): GeneratedConfigFile {
    const sampleConfig: SetupConfig = {
      'database.primary': {
        type: DatabaseType.POSTGRESQL,
        host: 'localhost',
        port: 5432,
        database: 'myapp_production',
        username: 'readonly_user',
        password: 'secure_password',
        ssl: true,
        select_only: true,
        timeout: 30000,
      },
      'database.analytics': {
        type: DatabaseType.MYSQL,
        host: 'analytics-server.company.com',
        port: 3306,
        database: 'analytics',
        username: 'analytics_user',
        password: 'analytics_password',
        ssl: false,
        select_only: false,
        timeout: 45000,
        ssh_host: 'bastion.company.com',
        ssh_port: 22,
        ssh_username: 'deploy_user',
        ssh_private_key: '/home/user/.ssh/id_rsa',
      },
      'database.local': {
        type: DatabaseType.SQLITE,
        file: './data/local.db',
        select_only: false,
        timeout: 10000,
      },
      extension: {
        max_rows: 1000,
        query_timeout: 30000,
        max_batch_size: 10,
        debug: false,
      },
      security: {
        max_joins: 10,
        max_subqueries: 5,
        max_unions: 3,
        max_group_bys: 5,
        max_complexity_score: 100,
        max_query_length: 10000,
      },
    };

    return this.generateConfigFile(sampleConfig, {
      version: '2.0.0',
      description: 'Sample Argos Configuration',
      generated: new Date(),
    });
  }

  /**
   * Generate configuration templates for different use cases
   */
  static generateTemplate(
    templateType: 'production' | 'development' | 'minimal'
  ): GeneratedConfigFile {
    let config: SetupConfig = {};
    let description = '';

    switch (templateType) {
      case 'production':
        config = this.createProductionTemplate();
        description = 'Production-ready Argos Configuration Template';
        break;
      case 'development':
        config = this.createDevelopmentTemplate();
        description = 'Development Argos Configuration Template';
        break;
      case 'minimal':
        config = this.createMinimalTemplate();
        description = 'Minimal Argos Configuration Template';
        break;
    }

    return this.generateConfigFile(config, {
      version: '2.0.0',
      description,
      generated: new Date(),
    });
  }

  private static createProductionTemplate(): SetupConfig {
    return {
      'database.primary': {
        type: DatabaseType.POSTGRESQL,
        host: 'prod-db.company.com',
        port: 5432,
        database: 'production',
        username: 'readonly_user',
        password: 'CHANGE_ME',
        ssl: true,
        select_only: true, // Safe for production
        timeout: 30000,
        ssh_host: 'bastion.company.com',
        ssh_port: 22,
        ssh_username: 'deploy_user',
        ssh_private_key: '/path/to/private/key',
      },
      extension: {
        max_rows: 500, // Conservative limit
        query_timeout: 15000, // Shorter timeout
        max_batch_size: 5,
        debug: false, // No debug in production
      },
      security: {
        max_joins: 5, // Stricter limits
        max_subqueries: 3,
        max_unions: 2,
        max_group_bys: 3,
        max_complexity_score: 50,
        max_query_length: 5000,
      },
    };
  }

  private static createDevelopmentTemplate(): SetupConfig {
    return {
      'database.dev': {
        type: DatabaseType.POSTGRESQL,
        host: 'localhost',
        port: 5432,
        database: 'development',
        username: 'dev_user',
        password: 'dev_password',
        ssl: false,
        select_only: false, // Full access for development
        timeout: 30000,
      },
      'database.test': {
        type: DatabaseType.SQLITE,
        file: './test.db',
        select_only: false,
        timeout: 10000,
      },
      extension: {
        max_rows: 2000,
        query_timeout: 60000,
        max_batch_size: 20,
        debug: true, // Debug enabled for development
      },
      security: {
        max_joins: 15,
        max_subqueries: 10,
        max_unions: 5,
        max_group_bys: 10,
        max_complexity_score: 200,
        max_query_length: 20000,
      },
    };
  }

  private static createMinimalTemplate(): SetupConfig {
    return {
      'database.main': {
        type: DatabaseType.SQLITE,
        file: './database.db',
        select_only: false,
        timeout: 30000,
      },
      extension: {
        max_rows: 1000,
        query_timeout: 30000,
        max_batch_size: 10,
        debug: false,
      },
    };
  }

  private static formatConfigValue(value: string | number | boolean): string {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return String(value);
  }

  private static countDatabases(config: SetupConfig): number {
    return Object.keys(config).filter((key) => key.startsWith('database.')).length;
  }

  private static hasSSHEnabled(config: SetupConfig): boolean {
    const databases = Object.keys(config).filter((key) => key.startsWith('database.'));
    return databases.some((key) => {
      const dbConfig = config[key] as DatabaseConfig;
      return !!dbConfig.ssh_host;
    });
  }
}
