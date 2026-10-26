import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { DatabaseType } from '../types/database.js';
import { validateConfig, loadConfig, saveConfigFile } from '../utils/config.js';
import { ui } from '../utils/setup-ui.js';
import type {
  SetupConfig,
  DatabaseConfig,
  DatabaseTypeString,
  ExtensionConfig,
  SecurityConfig,
  SetupWizardAction,
  ParsedServerConfig,
  DatabaseRedactionConfig,
  FieldRedactionRule,
} from '../types/config.js';
import { DEFAULT_DATABASE_PORTS } from '../types/config.js';

export interface SetupWizardOptions {
  configPath?: string;
  skipTests?: boolean;
}

/**
 *
 */
export class SetupWizard {
  private rl: readline.Interface;
  private config: SetupConfig = {};
  private existingDatabases: string[] = [];
  private configPath: string;
  private skipTests: boolean;

  constructor(options: SetupWizardOptions = {}) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.configPath = options.configPath || path.join(process.cwd(), 'config.ini');
    this.skipTests = options.skipTests || false;
  }

  /**
   *
   */
  async loadExistingConfig(): Promise<boolean> {
    try {
      if (fs.existsSync(this.configPath)) {
        ui.printInfo('Found existing config.ini file');

        const parsedConfig = await loadConfig(this.configPath);

        // Convert ParsedServerConfig to SetupConfig format
        this.config = {
          security: parsedConfig.security,
          extension: parsedConfig.extension,
        };

        // Add databases with database.* key format
        for (const [name, dbConfig] of Object.entries(parsedConfig.databases)) {
          this.config[`database.${name}`] = dbConfig;
        }

        // Only show debug if explicitly requested
        if (process.env.DEBUG_SETUP === 'true') {
          ui.printDebug('Parsed config structure', this.config);
        }

        // Extract database names
        this.existingDatabases = Object.keys(this.config)
          .filter((key) => key.startsWith('database.'))
          .map((key) => key.replace('database.', ''));

        if (this.existingDatabases.length > 0) {
          ui.printSuccess(
            `Found ${this.existingDatabases.length} existing database(s): ${this.existingDatabases.join(', ')}`
          );
          return true;
        } else {
          ui.printWarning('Config file exists but no database sections found');
        }
      }
      return false;
    } catch (error) {
      ui.logError(error as Error, 'Error loading existing config');
      return false;
    }
  }

  /**
   *
   */
  async showExistingDatabases(): Promise<void> {
    ui.printHeader(' Current Database Configurations:');

    for (const dbName of this.existingDatabases) {
      const dbKey = `database.${dbName}`;
      const dbConfig = this.config[dbKey] as DatabaseConfig;

      if (!dbConfig) {
        ui.printWarning(`Could not find config for ${dbName}`);
        continue;
      }

      ui.printDatabaseConfig(dbName, dbConfig);
    }

    const extensionConfig = this.config.extension as ExtensionConfig;
    if (extensionConfig) {
      ui.printExtensionConfig(extensionConfig);
    }

    const securityConfig = this.config.security as SecurityConfig;
    if (securityConfig) {
      ui.printSecurityConfig(securityConfig);
    }
    ui.printSeparator();
  }

  /**
   *
   */
  async handleExistingConfig(): Promise<SetupWizardAction> {
    await this.showExistingDatabases();

    ui.printSection(' Configuration Options:');
    ui.printOption(1, 'Add more database connections');
    ui.printOption(2, 'Test existing connections');
    ui.printOption(3, 'Modify extension settings');
    ui.printOption(4, 'Modify database access permissions');
    ui.printOption(5, 'Start fresh (overwrite existing config)');

    const choice = await this.askQuestion('\nWhat would you like to do? (1-5): ');

    ui.logUserAction('Menu selection', { choice: choice.trim() });

    switch (choice.trim()) {
      case '1':
        return await this.addMoreDatabases();
      case '2':
        return { action: 'test_only', databases: this.existingDatabases };
      case '3':
        return await this.modifyExtensionSettings();
      case '4':
        return await this.modifyDatabasePermissions();
      case '5':
        this.config = {};
        this.existingDatabases = [];
        return await this.setupDatabase();
      default:
        ui.printWarning('Invalid choice. Testing existing connections...');
        return { action: 'test_only', databases: this.existingDatabases };
    }
  }

  /**
   *
   */
  async modifyDatabasePermissions(): Promise<SetupWizardAction> {
    ui.printSection(' Database Access Permissions:');
    ui.print(
      ' SELECT-only mode restricts databases to SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements only.'
    );
    ui.print(' This is ideal for production databases or read-only access scenarios.');
    ui.printEmptyLine();

    for (const dbName of this.existingDatabases) {
      const dbKey = `database.${dbName}`;
      const dbConfig = this.config[dbKey] as DatabaseConfig;

      if (!dbConfig) continue;

      const currentMode = dbConfig.select_only === true;
      ui.printSubsection(dbName);
      ui.printDetail('Current mode', currentMode ? ' SELECT-only' : ' Full access');

      const newMode = await this.askQuestion(
        ` Change to SELECT-only mode? (current: ${currentMode ? 'yes' : 'no'}): `
      );

      if (newMode.toLowerCase() === 'y' || newMode.toLowerCase() === 'yes') {
        dbConfig.select_only = true;
        ui.printSuccess(`Updated ${dbName} to SELECT-only mode`);
        ui.logUserAction('Database permission change', { database: dbName, mode: 'select_only' });
      } else if (newMode.toLowerCase() === 'n' || newMode.toLowerCase() === 'no') {
        dbConfig.select_only = false;
        ui.printSuccess(`Updated ${dbName} to full access mode`);
        ui.logUserAction('Database permission change', { database: dbName, mode: 'full_access' });
      } else {
        ui.print(` -> Keeping current setting for ${dbName}`);
      }

      // Update the config
      this.config[dbKey] = dbConfig;
    }

    ui.printEmptyLine();
    ui.printSuccess('Database permissions updated');
    return { action: 'save_and_test', databases: this.existingDatabases };
  }

  /**
   *
   */
  async addMoreDatabases(): Promise<SetupWizardAction> {
    ui.printSection(' Adding New Database Connections');
    ui.printEmptyLine();

    const newDatabases: string[] = [];
    let addMore = true;

    while (addMore) {
      ui.print(`\nConfiguring new database connection #${newDatabases.length + 1}:`);

      const dbName = await this.askQuestion('Database name (e.g., primary, analytics): ');

      // Check if database name already exists
      if (this.existingDatabases.includes(dbName)) {
        const overwrite = await this.askQuestion(
          `Database '${dbName}' already exists. Overwrite? (y/n): `
        );
        if (overwrite.toLowerCase() !== 'y') {
          ui.print('Skipping this database...');
          continue;
        }
      }

      const dbTypeInput = await this.askQuestion('Database type (postgresql/mysql/sqlite/mssql): ');
      const dbType = this.parseDbType(dbTypeInput);

      const dbConfig = await this.createDatabaseConfig(dbType, dbName);

      this.config[`database.${dbName}`] = dbConfig;
      newDatabases.push(dbName);

      ui.printSuccess(
        `Database '${dbName}' configured with ${dbConfig.select_only ? 'SELECT-only' : 'full'} access`
      );

      const continueAdding = await this.askQuestion('\nAdd another database? (y/n): ');
      addMore = continueAdding.toLowerCase() === 'y';
    }

    // Update existing databases list
    this.existingDatabases = [...this.existingDatabases, ...newDatabases];

    return { action: 'save_and_test', databases: this.existingDatabases };
  }

  private parseDbType(input: string): DatabaseType {
    const normalized = input.toLowerCase().trim();
    switch (normalized) {
      case 'postgresql':
      case 'postgres':
        return DatabaseType.POSTGRESQL;
      case 'mysql':
        return DatabaseType.MYSQL;
      case 'sqlite':
      case 'sqlite3':
        return DatabaseType.SQLITE;
      case 'mssql':
      case 'sqlserver':
      case 'sql server':
        return DatabaseType.MSSQL;
      default:
        ui.printWarning(`Unknown database type '${input}', defaulting to PostgreSQL`);
        return DatabaseType.POSTGRESQL;
    }
  }

  private async createDatabaseConfig(
    dbType: DatabaseType,
    dbName?: string
  ): Promise<DatabaseConfig> {
    const dbConfig: Partial<DatabaseConfig> = {
      type: dbType,
    };

    if (dbType === DatabaseType.SQLITE) {
      dbConfig.file = await this.askQuestion('SQLite file path: ');
    } else {
      dbConfig.host = await this.askQuestion('Database host: ');
      const defaultPort = DEFAULT_DATABASE_PORTS[dbType as DatabaseTypeString] ?? 0;
      const portInput = await this.askQuestion(`Database port (default: ${defaultPort}): `);
      dbConfig.port = parseInt(portInput) || defaultPort;
      dbConfig.database = await this.askQuestion('Database name: ');
      dbConfig.username = await this.askQuestion('Username: ');
      dbConfig.password = await this.askQuestion('Password: ');

      const useSsl = await this.askQuestion('Use SSL? (y/n): ');
      dbConfig.ssl = useSsl.toLowerCase() === 'y';

      // SSH Tunnel Configuration
      const useSSH = await this.askQuestion('Use SSH tunnel? (y/n): ');
      if (useSSH.toLowerCase() === 'y') {
        ui.print('\n--- SSH Tunnel Configuration ---');
        dbConfig.ssh_host = await this.askQuestion('SSH host: ');
        const sshPortInput = await this.askQuestion('SSH port (default: 22): ');
        dbConfig.ssh_port = parseInt(sshPortInput) || 22;
        dbConfig.ssh_username = await this.askQuestion('SSH username: ');

        const authMethod = await this.askQuestion('SSH auth method (password/key): ');
        if (authMethod.toLowerCase() === 'password') {
          dbConfig.ssh_password = await this.askQuestion('SSH password: ');
        } else {
          dbConfig.ssh_private_key = await this.askQuestion('SSH private key path: ');
          const hasPassphrase = await this.askQuestion('Private key has passphrase? (y/n): ');
          if (hasPassphrase.toLowerCase() === 'y') {
            dbConfig.ssh_passphrase = await this.askQuestion('SSH key passphrase: ');
          }
        }

        const localPortInput = await this.askQuestion('Local port for tunnel (default: auto): ');
        dbConfig.local_port = parseInt(localPortInput) || 0;
      }
    }

    // SELECT-only mode configuration
    ui.print('\n--- Access Permissions ---');
    ui.print(
      'SELECT-only mode restricts this database to SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements only.'
    );
    ui.print('This is recommended for production databases or read-only access scenarios.');
    const selectOnly = await this.askQuestion('Enable SELECT-only mode? (y/n): ');
    dbConfig.select_only = selectOnly.toLowerCase() === 'y';

    // Field Redaction Configuration
    const redactionConfig = await this.configureRedaction(dbName || 'unknown');
    if (redactionConfig) {
      dbConfig.redaction = redactionConfig;
    }

    const timeoutInput = await this.askQuestion('Connection timeout (ms, default: 30000): ');
    dbConfig.timeout = parseInt(timeoutInput) || 30000;

    return dbConfig as DatabaseConfig;
  }

  /**
   *
   */
  async modifyExtensionSettings(): Promise<SetupWizardAction> {
    const currentExtension = (this.config.extension as ExtensionConfig) || {};
    const currentSecurity = (this.config.security as SecurityConfig) || {};

    ui.printSection(' Current Extension Settings:');
    ui.printDetail('Max Rows', currentExtension.max_rows || 1000);
    ui.printDetail('Query Timeout', `${currentExtension.query_timeout || 30000}ms`);
    ui.printDetail('Max Batch Size', currentExtension.max_batch_size || 10);
    ui.printDetail('Debug Mode', currentExtension.debug ? 'enabled' : 'disabled');

    ui.printSection(' Current Security Settings:');
    ui.printDetail('Max JOINs', currentSecurity.max_joins || 10);
    ui.printDetail('Max Subqueries', currentSecurity.max_subqueries || 5);
    ui.printDetail('Max UNIONs', currentSecurity.max_unions || 3);
    ui.printDetail('Max GROUP BYs', currentSecurity.max_group_bys || 5);
    ui.printDetail('Max Complexity Score', currentSecurity.max_complexity_score || 100);
    ui.printDetail('Max Query Length', currentSecurity.max_query_length || 10000);

    const modify = await this.askQuestion('\nModify extension settings? (y/n): ');

    if (modify.toLowerCase() === 'y') {
      ui.print('\n--- Extension Settings ---');
      const maxRowsInput = await this.askQuestion(
        `Maximum rows per query (current: ${currentExtension.max_rows || 1000}): `
      );
      const queryTimeoutInput = await this.askQuestion(
        `Query timeout ms (current: ${currentExtension.query_timeout || 30000}): `
      );
      const maxBatchSizeInput = await this.askQuestion(
        `Maximum queries in batch operations (current: ${currentExtension.max_batch_size || 10}): `
      );
      const debugInput = await this.askQuestion(
        `Enable debug mode? (current: ${currentExtension.debug ? 'y' : 'n'}): `
      );

      this.config.extension = {
        max_rows: parseInt(maxRowsInput) || currentExtension.max_rows || 1000,
        query_timeout: parseInt(queryTimeoutInput) || currentExtension.query_timeout || 30000,
        max_batch_size: parseInt(maxBatchSizeInput) || currentExtension.max_batch_size || 10,
        debug: debugInput.toLowerCase() === 'y' || (debugInput === '' && currentExtension.debug),
      };

      const modifySecurity = await this.askQuestion('\nModify security settings? (y/n): ');

      if (modifySecurity.toLowerCase() === 'y') {
        ui.print('\n--- Security Settings ---');
        const maxJoinsInput = await this.askQuestion(
          `Maximum JOINs per query (current: ${currentSecurity.max_joins || 10}): `
        );
        const maxSubqueriesInput = await this.askQuestion(
          `Maximum subqueries per query (current: ${currentSecurity.max_subqueries || 5}): `
        );
        const maxUnionsInput = await this.askQuestion(
          `Maximum UNIONs per query (current: ${currentSecurity.max_unions || 3}): `
        );
        const maxGroupBysInput = await this.askQuestion(
          `Maximum GROUP BY clauses per query (current: ${currentSecurity.max_group_bys || 5}): `
        );
        const maxComplexityInput = await this.askQuestion(
          `Maximum complexity score per query (current: ${currentSecurity.max_complexity_score || 100}): `
        );
        const maxQueryLengthInput = await this.askQuestion(
          `Maximum query length in characters (current: ${currentSecurity.max_query_length || 10000}): `
        );

        this.config.security = {
          max_joins: parseInt(maxJoinsInput) || currentSecurity.max_joins || 10,
          max_subqueries: parseInt(maxSubqueriesInput) || currentSecurity.max_subqueries || 5,
          max_unions: parseInt(maxUnionsInput) || currentSecurity.max_unions || 3,
          max_group_bys: parseInt(maxGroupBysInput) || currentSecurity.max_group_bys || 5,
          max_complexity_score:
            parseInt(maxComplexityInput) || currentSecurity.max_complexity_score || 100,
          max_query_length:
            parseInt(maxQueryLengthInput) || currentSecurity.max_query_length || 10000,
        };
      }

      ui.printSuccess('Extension settings updated');
    }

    return { action: 'save_and_test', databases: this.existingDatabases };
  }

  /**
   *
   */
  async setupDatabase(): Promise<SetupWizardAction> {
    ui.printHeader('=== Claude SQL Extension Configuration ===');
    ui.printEmptyLine();

    const databases: string[] = [];
    let addMore = true;

    while (addMore) {
      ui.print(`\nConfiguring database connection #${databases.length + 1}:`);

      const dbName = await this.askQuestion('Database name (e.g., primary, analytics): ');
      const dbTypeInput = await this.askQuestion('Database type (postgresql/mysql/sqlite/mssql): ');
      const dbType = this.parseDbType(dbTypeInput);

      const dbConfig = await this.createDatabaseConfig(dbType, dbName);

      this.config[`database.${dbName}`] = dbConfig;
      databases.push(dbName);

      ui.printSuccess(
        `Database '${dbName}' configured with ${dbConfig.select_only ? 'SELECT-only' : 'full'} access`
      );

      const continueAdding = await this.askQuestion('\nAdd another database? (y/n): ');
      addMore = continueAdding.toLowerCase() === 'y';
    }

    // Extension settings (only if not already configured)
    if (!this.config.extension) {
      ui.print('\n--- Extension Settings ---');
      const maxRowsInput = await this.askQuestion('Maximum rows per query (default: 1000): ');
      const queryTimeoutInput = await this.askQuestion('Query timeout (ms, default: 30000): ');
      const maxBatchSizeInput = await this.askQuestion(
        'Maximum queries in batch operations (default: 10): '
      );
      const debug = await this.askQuestion('Enable debug mode? (y/n): ');

      this.config.extension = {
        max_rows: parseInt(maxRowsInput) || 1000,
        query_timeout: parseInt(queryTimeoutInput) || 30000,
        max_batch_size: parseInt(maxBatchSizeInput) || 10,
        debug: debug.toLowerCase() === 'y',
      };
    }

    // Security settings (only if not already configured)
    if (!this.config.security) {
      ui.print('\n--- Security & Performance Limits ---');
      ui.print('These settings control query complexity limits to prevent resource abuse:');

      const configureSecurity = await this.askQuestion(
        'Configure advanced security limits? (y/n, default: n): '
      );

      if (configureSecurity.toLowerCase() === 'y') {
        const maxJoinsInput = await this.askQuestion('Maximum JOINs per query (default: 10): ');
        const maxSubqueriesInput = await this.askQuestion(
          'Maximum subqueries per query (default: 5): '
        );
        const maxUnionsInput = await this.askQuestion('Maximum UNIONs per query (default: 3): ');
        const maxGroupBysInput = await this.askQuestion(
          'Maximum GROUP BY clauses per query (default: 5): '
        );
        const maxComplexityInput = await this.askQuestion(
          'Maximum complexity score per query (default: 100): '
        );
        const maxQueryLengthInput = await this.askQuestion(
          'Maximum query length in characters (default: 10000): '
        );

        this.config.security = {
          max_joins: parseInt(maxJoinsInput) || 10,
          max_subqueries: parseInt(maxSubqueriesInput) || 5,
          max_unions: parseInt(maxUnionsInput) || 3,
          max_group_bys: parseInt(maxGroupBysInput) || 5,
          max_complexity_score: parseInt(maxComplexityInput) || 100,
          max_query_length: parseInt(maxQueryLengthInput) || 10000,
        };

        ui.printSuccess('Security limits configured');
      } else {
        ui.printSuccess('Using default security limits (max joins: 10, max subqueries: 5, etc.)');
      }
    }

    return { action: 'save_and_test', databases };
  }

  private async configureRedaction(dbName: string): Promise<DatabaseRedactionConfig | undefined> {
    ui.print('\n--- Field Redaction Configuration ---');
    ui.print(
      'Field redaction automatically masks sensitive data (emails, phone numbers, SSNs, etc.)'
    );
    ui.print(
      'in query results to protect privacy and ensure compliance with data protection regulations.'
    );
    ui.printEmptyLine();

    const enableRedaction = await this.askQuestion(
      'Enable field redaction for sensitive data? (y/n): '
    );

    if (enableRedaction.toLowerCase() !== 'y') {
      return undefined;
    }

    const rules: FieldRedactionRule[] = [];

    // Pre-defined common sensitive field patterns
    const commonFields = [
      {
        name: 'email',
        description: 'Email addresses',
        pattern: '*email*',
        example: 'user_email, contact_email',
      },
      {
        name: 'phone',
        description: 'Phone numbers',
        pattern: '*phone*',
        example: 'phone_number, mobile_phone',
      },
      {
        name: 'ssn',
        description: 'Social Security Numbers',
        pattern: '*ssn*',
        example: 'ssn, social_security_number',
      },
      {
        name: 'password',
        description: 'Password fields',
        pattern: '*password*',
        example: 'password, user_password',
      },
      {
        name: 'credit_card',
        description: 'Credit card numbers',
        pattern: '*card*',
        example: 'credit_card, card_number',
      },
    ];

    ui.printSubsection('Configure Common Sensitive Fields:');

    for (const field of commonFields) {
      ui.print(`\n${field.description} (matches: ${field.example}):`);
      const shouldRedact = await this.askQuestion(
        ` Redact ${field.description.toLowerCase()}? (y/n): `
      );

      if (shouldRedact.toLowerCase() === 'y') {
        ui.print(' Redaction options:');
        ui.print(' 1. Partial masking - preserves format (e.g., j***@***.com)');
        ui.print(' 2. Full masking - replaces with asterisks (e.g., ***********)');
        ui.print(' 3. Replace with text - uses fixed replacement (e.g., [REDACTED])');

        const redactionType = await this.askQuestion(' Choose redaction type (1-3): ');

        let redactionTypeValue: FieldRedactionRule['redaction_type'];
        let replacementText: string | undefined;

        switch (redactionType) {
          case '1':
            redactionTypeValue = 'partial_mask';
            break;
          case '2':
            redactionTypeValue = 'full_mask';
            break;
          case '3':
            redactionTypeValue = 'replace';
            replacementText = await this.askQuestion(
              ` Enter replacement text (default: [${field.name.toUpperCase()}_REDACTED]): `
            );
            if (!replacementText.trim()) {
              replacementText = `[${field.name.toUpperCase()}_REDACTED]`;
            }
            break;
          default:
            ui.printWarning(' Invalid choice, using partial masking');
            redactionTypeValue = 'partial_mask';
        }

        const rule: FieldRedactionRule = {
          field_pattern: field.pattern,
          pattern_type: 'wildcard',
          redaction_type: redactionTypeValue,
          preserve_format: redactionTypeValue === 'partial_mask',
          description: `Redact ${field.description.toLowerCase()}`,
        };

        if (replacementText) {
          rule.replacement_text = replacementText;
        }

        rules.push(rule);
        ui.printSuccess(` Added redaction rule for ${field.description.toLowerCase()}`);
      }
    }

    // Allow custom rules
    ui.printSubsection('Custom Redaction Rules:');
    const addCustom = await this.askQuestion('Add custom redaction rules? (y/n): ');

    if (addCustom.toLowerCase() === 'y') {
      let addingCustomRules = true;

      while (addingCustomRules) {
        ui.print('\nCustom redaction rule:');
        const fieldPattern = await this.askQuestion(
          'Field pattern (e.g., customer_id, *secret*, /^user_.+$/): '
        );

        if (!fieldPattern.trim()) {
          ui.printWarning('Empty field pattern, skipping...');
          continue;
        }

        // Determine pattern type
        let patternType: FieldRedactionRule['pattern_type'] = 'exact';
        if (fieldPattern.includes('*')) {
          patternType = 'wildcard';
          ui.printInfo('Detected wildcard pattern');
        } else if (fieldPattern.startsWith('/') && fieldPattern.endsWith('/')) {
          patternType = 'regex';
          ui.printInfo('Detected regex pattern');
        }

        ui.print('Redaction type:');
        ui.print('1. Partial masking');
        ui.print('2. Full masking');
        ui.print('3. Replace with fixed text');

        const redactionType = await this.askQuestion('Choose redaction type (1-3): ');

        let redactionTypeValue: FieldRedactionRule['redaction_type'] = 'partial_mask';
        let replacementText: string | undefined;

        switch (redactionType) {
          case '1':
            redactionTypeValue = 'partial_mask';
            break;
          case '2':
            redactionTypeValue = 'full_mask';
            break;
          case '3':
            redactionTypeValue = 'replace';
            replacementText = await this.askQuestion(
              'Enter replacement text (default: [REDACTED]): '
            );
            if (!replacementText.trim()) {
              replacementText = '[REDACTED]';
            }
            break;
          default:
            ui.printWarning('Invalid choice, using partial masking');
        }

        const rule: FieldRedactionRule = {
          field_pattern: fieldPattern,
          pattern_type: patternType,
          redaction_type: redactionTypeValue,
          preserve_format: redactionTypeValue === 'partial_mask',
        };

        if (replacementText) {
          rule.replacement_text = replacementText;
        }

        rules.push(rule);
        ui.printSuccess(` Added custom redaction rule: ${fieldPattern} -> ${redactionTypeValue}`);

        const addAnother = await this.askQuestion('Add another custom rule? (y/n): ');
        addingCustomRules = addAnother.toLowerCase() === 'y';
      }
    }

    if (rules.length === 0) {
      ui.printInfo('No redaction rules configured, disabling field redaction');
      return undefined;
    }

    // Additional settings
    ui.printSubsection('Redaction Settings:');
    const logAccess = await this.askQuestion('Log when redacted fields are accessed? (y/n): ');
    const caseSensitive = await this.askQuestion(
      'Case-sensitive field matching? (y/n, default: n): '
    );

    const redactionConfig: DatabaseRedactionConfig = {
      enabled: true,
      rules,
      log_redacted_access: logAccess.toLowerCase() === 'y',
      case_sensitive_matching: caseSensitive.toLowerCase() === 'y',
    };

    // Summary
    ui.printSubsection(`Redaction Summary for '${dbName}':`);
    ui.printDetail('Rules configured', rules.length.toString());
    ui.printDetail('Log access', redactionConfig.log_redacted_access ? 'Yes' : 'No');
    ui.printDetail('Case sensitive', redactionConfig.case_sensitive_matching ? 'Yes' : 'No');

    if (rules.length > 0) {
      ui.print(' Configured rules:');
      for (const rule of rules) {
        const typeDesc =
          rule.redaction_type === 'partial_mask'
            ? 'partial mask'
            : rule.redaction_type === 'full_mask'
              ? 'full mask'
              : rule.redaction_type === 'replace'
                ? `replace with "${rule.replacement_text}"`
                : rule.redaction_type;
        ui.print(` - ${rule.field_pattern} -> ${typeDesc}`);
      }
    }

    ui.printSuccess(`Field redaction configured for database '${dbName}'`);
    return redactionConfig;
  }

  /**
   *
   */
  async saveConfig(): Promise<void> {
    try {
      // Validate configuration before saving
      // Convert SetupConfig to ParsedServerConfig format for validation
      const parsedConfigForValidation: ParsedServerConfig = {
        databases: {},
        security: this.config.security,
        extension: this.config.extension,
      };

      // Extract databases
      for (const [key, value] of Object.entries(this.config)) {
        if (key.startsWith('database.')) {
          const dbName = key.replace('database.', '');
          parsedConfigForValidation.databases[dbName] = value as DatabaseConfig;
        }
      }

      validateConfig(parsedConfigForValidation);

      // Convert SetupConfig to ParsedServerConfig format
      const parsedConfig: ParsedServerConfig = {
        databases: {},
        security: this.config.security,
        extension: this.config.extension,
      };

      // Extract databases
      for (const [key, value] of Object.entries(this.config)) {
        if (key.startsWith('database.')) {
          const dbName = key.replace('database.', '');
          parsedConfig.databases[dbName] = value as DatabaseConfig;
        }
      }

      await saveConfigFile(parsedConfig, this.configPath);
      ui.printSuccess('Configuration saved to config.ini');

      // Show security summary
      this.showSecuritySummary();

      // Show debug info only if requested
      if (process.env.DEBUG_SETUP === 'true') {
        ui.printSection(' Debug - Config file contents:');
        ui.print('-----------------------------------');
        ui.print(fs.readFileSync(this.configPath, 'utf-8'));
        ui.print('-----------------------------------');
      }
    } catch (error) {
      ui.logError(error as Error, 'Failed to save configuration');
      throw error;
    }
  }

  private showSecuritySummary(): void {
    ui.printSection(' Security Summary:');
    const selectOnlyDbs: string[] = [];
    const fullAccessDbs: string[] = [];

    for (const [key, value] of Object.entries(this.config)) {
      if (key.startsWith('database.')) {
        const dbName = key.replace('database.', '');
        const dbConfig = value as DatabaseConfig;
        if (dbConfig.select_only) {
          selectOnlyDbs.push(dbName);
        } else {
          fullAccessDbs.push(dbName);
        }
      }
    }

    if (selectOnlyDbs.length > 0) {
      ui.printDetail(' SELECT-only databases', selectOnlyDbs.join(', '));
    }
    if (fullAccessDbs.length > 0) {
      ui.printDetail(' Full-access databases', fullAccessDbs.join(', '));
    }
  }

  /**
   *
   */
  async testConnections(databases: string[]): Promise<void> {
    if (this.skipTests) {
      ui.printInfo('Skipping connection tests');
      return;
    }

    ui.print('\n--- Testing Connections ---');

    // Add a small delay to ensure file system operations complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Test config loading manually first
      ui.printInfo('Testing config loading...');
      const parsedConfig = await loadConfig(this.configPath);

      ui.printInfo('Parsed config sections:');
      ui.printDetail('databases', `${Object.keys(parsedConfig.databases).length} configured`);
      if (parsedConfig.security) ui.printDetail('security', 'configured');
      if (parsedConfig.extension) ui.printDetail('extension', 'configured');

      // Check if our databases exist in parsed config
      for (const dbName of databases) {
        const dbConfig = parsedConfig.databases[dbName];
        if (dbConfig) {
          ui.printSuccess(`Found config for ${dbName}`);
          ui.printDetail('Access mode', dbConfig.select_only ? 'SELECT-only' : 'Full access');
        } else {
          ui.printError(`Missing config for ${dbName}`);
        }
      }

      // Now try loading the extension for testing
      try {
        const { SQLMCPServer } = await import('../classes/SQLMCPServer.js');

        // Create a temporary server instance for testing
        const server = new SQLMCPServer();
        await server.initialize();

        for (const dbName of databases) {
          try {
            ui.print(`\nTesting ${dbName}...`);
            const result = await server.testConnection(dbName);
            if (result.success) {
              ui.printSuccess('Connected');

              // If successful and schema was captured, show summary
              if (result.schema_captured) {
                ui.printDetail(
                  'Schema captured',
                  `${result.schema_info?.table_count || 0} tables, ${result.schema_info?.total_columns || 0} columns`
                );
              }

              // Show access mode
              if (result.select_only_mode !== undefined) {
                ui.printDetail(
                  'Access mode',
                  result.select_only_mode ? 'SELECT-only' : 'Full access'
                );
              }
            } else {
              ui.printError(`Failed: ${result.error}`);
            }
          } catch (error) {
            ui.printError(`Failed: ${(error as Error).message}`);
          }
        }
      } catch (importError) {
        ui.printError(`Failed to load extension: ${(importError as Error).message}`);
        ui.print(
          'Skipping connection tests - extension will be available when you run "npm start"'
        );
      }
    } catch (configError) {
      ui.printError(`Failed to load config: ${(configError as Error).message}`);
    }
  }

  /**
   *
   */
  async run(): Promise<void> {
    ui.printInfo(' Claude SQL Extension Setup Starting...');
    ui.printEmptyLine();

    try {
      const hasExistingConfig = await this.loadExistingConfig();
      let result: SetupWizardAction;

      if (hasExistingConfig) {
        // Handle existing configuration
        result = await this.handleExistingConfig();
      } else {
        // Fresh setup
        ui.printInfo('No existing configuration found. Starting fresh setup...');
        result = await this.setupDatabase();
      }

      // Handle the result
      switch (result.action) {
        case 'save_and_test':
          await this.saveConfig();

          // Ask about testing if we have databases
          if (result.databases.length > 0) {
            const testNow = await this.askQuestion('\nTest database connections now? (y/n): ');
            if (testNow.toLowerCase() === 'y') {
              await this.testConnections(result.databases);
            }
          }
          break;

        case 'test_only':
          // Just test existing connections
          if (result.databases.length > 0) {
            await this.testConnections(result.databases);
          }
          break;
      }

      ui.printSuccess(' Configuration complete!');
      ui.printInfo(' Available commands:');
      ui.print(' - npm start - Start the SQL extension');
      ui.print(' - npm run setup - Run configuration again');
      ui.print(' - npm test - Test connections');

      ui.printSection(' Security Notes:');
      ui.print(
        ' - SELECT-only databases block INSERT, UPDATE, DELETE, DROP, CREATE, ALTER operations'
      );
      ui.print(' - Use SELECT-only mode for production databases and read-only access scenarios');
      ui.print(' - Full-access databases should be used with caution and proper user permissions');
    } catch (error) {
      ui.logError(error as Error, 'Setup failed');
      throw error;
    } finally {
      this.rl.close();
    }
  }

  private async askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  // Clean up resources
  /**
   *
   */
  close(): void {
    this.rl.close();
  }
}
