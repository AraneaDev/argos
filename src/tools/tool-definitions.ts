/**
 * MCP Tool Definitions
 * JSON schema definitions for all Argos tools
 */

/**
 *
 */
export function getToolDefinitions() {
  return [
    {
      name: 'sql_query',
      description:
        'Execute a single SQL query on a configured database with automatic schema awareness and SELECT-only security enforcement.',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Database name from configuration',
          },
          query: {
            type: 'string',
            description: 'SQL query to execute',
          },
          params: {
            type: 'array',
            description: 'Optional query parameters for prepared statements',
            items: { type: 'string' },
          },
        },
        required: ['database', 'query'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_batch_query',
      description:
        'Execute multiple SQL queries in batch on a configured database for improved performance. All queries must pass security validation.',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Database name from configuration',
          },
          queries: {
            type: 'array',
            description: 'Array of SQL queries to execute in batch',
            items: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'SQL query to execute',
                },
                params: {
                  type: 'array',
                  description: 'Optional query parameters',
                  items: { type: 'string' },
                },
                label: {
                  type: 'string',
                  description: 'Optional label to identify this query in results',
                },
              },
              required: ['query'],
              additionalProperties: false,
            },
          },
          transaction: {
            type: 'boolean',
            description:
              'Execute all queries in a single transaction (only for full-access databases)',
            default: false,
          },
        },
        required: ['database', 'queries'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_analyze_performance',
      description: 'Analyze query performance and suggest optimizations using EXPLAIN plans',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Database name from configuration',
          },
          query: {
            type: 'string',
            description: 'SQL query to analyze',
          },
        },
        required: ['database', 'query'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_list_databases',
      description:
        'List all configured databases with connection status, schema information, and security settings',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'sql_get_schema',
      description:
        'Get detailed schema information for a database including tables, columns, relationships',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Database name to get schema for',
          },
          table: {
            type: 'string',
            description: 'Optional: Get schema for specific table only',
          },
        },
        required: ['database'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_test_connection',
      description:
        'Test connection to a database (creates SSH tunnel if needed and captures schema)',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Database name to test',
          },
        },
        required: ['database'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_refresh_schema',
      description: 'Refresh cached schema for a database after structural changes',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Database name to refresh schema for',
          },
        },
        required: ['database'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_add_database',
      description:
        'Add a new database configuration. The new database will be MCP-configurable by default.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique name for the database' },
          type: {
            type: 'string',
            enum: ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'],
            description: 'Database type',
          },
          host: { type: 'string', description: 'Database host (not needed for SQLite)' },
          port: { type: 'number', description: 'Database port (uses default for type if omitted)' },
          database: { type: 'string', description: 'Database name on the server' },
          username: { type: 'string', description: 'Database username' },
          password: { type: 'string', description: 'Database password' },
          file: { type: 'string', description: 'File path (SQLite only)' },
          ssl: { type: 'boolean', description: 'Enable SSL', default: false },
          ssl_verify: {
            type: 'boolean',
            description:
              'Verify SSL certificates. Defaults to true when SSL is enabled. Cannot be set to false via MCP (disabling verification requires a manual config.ini edit).',
            default: true,
          },
          select_only: {
            type: 'boolean',
            description: 'Restrict to SELECT queries only',
            default: true,
          },
          ssh_host: { type: 'string', description: 'SSH tunnel host' },
          ssh_port: { type: 'number', description: 'SSH tunnel port', default: 22 },
          ssh_username: { type: 'string', description: 'SSH username' },
          ssh_password: { type: 'string', description: 'SSH password' },
          ssh_private_key: { type: 'string', description: 'SSH private key path' },
        },
        required: ['name', 'type'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_update_database',
      description:
        'Update settings on an existing database. Only works on databases with mcp_configurable=true.',
      inputSchema: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database name to update' },
          host: { type: 'string', description: 'New host' },
          port: { type: 'number', description: 'New port' },
          database_name: { type: 'string', description: 'New database name on server' },
          username: { type: 'string', description: 'New username' },
          password: { type: 'string', description: 'New password' },
          file: { type: 'string', description: 'New file path (SQLite)' },
          ssl: { type: 'boolean', description: 'Enable/disable SSL' },
          ssl_verify: {
            type: 'boolean',
            description: 'Verify SSL certificates (set true for CA-signed certs)',
          },
          select_only: { type: 'boolean', description: 'Enable/disable SELECT-only mode' },
          ssh_host: { type: 'string', description: 'SSH tunnel host' },
          ssh_port: { type: 'number', description: 'SSH tunnel port' },
          ssh_username: { type: 'string', description: 'SSH username' },
          ssh_password: { type: 'string', description: 'SSH password' },
          ssh_private_key: { type: 'string', description: 'SSH private key path' },
        },
        required: ['database'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_remove_database',
      description:
        'Remove a database configuration. Only works on databases with mcp_configurable=true.',
      inputSchema: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database name to remove' },
        },
        required: ['database'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_get_config',
      description: 'Get the current configuration of a database (passwords are redacted in output)',
      inputSchema: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database name to get config for' },
        },
        required: ['database'],
        additionalProperties: false,
      },
    },
    {
      name: 'sql_get_metrics',
      description:
        'Get in-memory performance metrics for configured databases. Returns query latency (min/max/avg/p95), error counts by category, circuit breaker state, cache hit rate, and pool utilization.',
      inputSchema: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Optional database name. Omit to get metrics for all databases.',
          },
        },
        required: [],
      },
    },
    {
      name: 'sql_set_mcp_configurable',
      description:
        'Lock a database from MCP configuration changes by setting mcp_configurable to false. Once locked, only manual config.ini editing can re-enable MCP configuration access.',
      inputSchema: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database name' },
          enabled: {
            type: 'boolean',
            description:
              'Must be false. Setting to true requires manual config.ini editing for security.',
          },
        },
        required: ['database', 'enabled'],
        additionalProperties: false,
      },
    },
  ];
}
