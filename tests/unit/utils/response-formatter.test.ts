/**
 * Response Formatter Tests
 */

import {
  createToolResponse,
  formatTableResults,
  formatCondensedTableResults,
  formatDatabaseSummary,
} from '../../../src/utils/response-formatter.js';
import type { QueryResult, DatabaseListItem } from '../../../src/types/index.js';

describe('response-formatter', () => {
  // ============================================================================
  // createToolResponse
  // ============================================================================

  describe('createToolResponse', () => {
    it('should create success response', () => {
      const response = createToolResponse('Success message');

      expect(response.content).toEqual([{ type: 'text', text: 'Success message' }]);
      expect(response._meta).toEqual({ progressToken: null });
      expect(response.isError).toBeUndefined();
    });

    it('should create error response', () => {
      const response = createToolResponse('Error occurred', true);

      expect(response.content[0].text).toBe('Error occurred');
      expect(response.isError).toBe(true);
    });

    it('should not set isError when false', () => {
      const response = createToolResponse('ok', false);
      expect(response.isError).toBeUndefined();
    });
  });

  // ============================================================================
  // formatTableResults
  // ============================================================================

  describe('formatTableResults', () => {
    it('should return no results message for empty rows', () => {
      const data: QueryResult = {
        rows: [],
        rowCount: 0,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatTableResults(data)).toBe('No results returned.\n');
    });

    it('should return no columns message for empty fields', () => {
      const data: QueryResult = {
        rows: [{}],
        rowCount: 1,
        fields: [],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatTableResults(data)).toBe('No columns returned.\n');
    });

    it('should format basic table results', () => {
      const data: QueryResult = {
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        rowCount: 2,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);

      expect(result).toContain('| id | name |');
      expect(result).toContain('|---|---|');
      expect(result).toContain('| 1 | Alice |');
      expect(result).toContain('| 2 | Bob |');
    });

    it('should handle NULL values', () => {
      const data: QueryResult = {
        rows: [{ id: 1, name: null }],
        rowCount: 1,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('NULL');
    });

    it('should handle undefined values', () => {
      const data: QueryResult = {
        rows: [{ id: 1 }], // name field missing = undefined
        rowCount: 1,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('NULL');
    });

    it('should truncate long string values', () => {
      const longString = 'a'.repeat(60);
      const data: QueryResult = {
        rows: [{ text: longString }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('...');
      expect(result).not.toContain(longString);
    });

    it('should not truncate strings under 50 chars', () => {
      const data: QueryResult = {
        rows: [{ text: 'short string' }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('short string');
    });

    it('should handle object values (JSON stringify)', () => {
      const data: QueryResult = {
        rows: [{ data: { nested: 'value' } }],
        rowCount: 1,
        fields: ['data'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('{"nested":"value"}');
    });

    it('should limit to 20 rows', () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
      const data: QueryResult = {
        rows,
        rowCount: 25,
        fields: ['id'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('... and 5 more rows');
      // Should contain row 20 but not 21
      expect(result).toContain('| 20 |');
      expect(result).not.toMatch(/\| 21 \|/);
    });

    it('should not show more rows message when exactly 20', () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
      const data: QueryResult = {
        rows,
        rowCount: 20,
        fields: ['id'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).not.toContain('more rows');
    });

    it('should handle numeric values', () => {
      const data: QueryResult = {
        rows: [{ count: 42, price: 9.99 }],
        rowCount: 1,
        fields: ['count', 'price'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('42');
      expect(result).toContain('9.99');
    });

    it('should handle boolean values', () => {
      const data: QueryResult = {
        rows: [{ active: true, deleted: false }],
        rowCount: 1,
        fields: ['active', 'deleted'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain('true');
      expect(result).toContain('false');
    });

    it('should render the exact markdown table', () => {
      const data: QueryResult = {
        rows: [{ id: 1, name: 'Alice' }],
        rowCount: 1,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatTableResults(data)).toBe('| id | name |\n|---|---|\n| 1 | Alice |\n');
    });

    it('should not truncate strings of exactly 50 chars', () => {
      const s = 'b'.repeat(50);
      const data: QueryResult = {
        rows: [{ text: s }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatTableResults(data);
      expect(result).toContain(`| ${s} |`);
      expect(result).not.toContain('...');
    });

    it('should truncate a 51-char string to 47 chars plus ellipsis', () => {
      const data: QueryResult = {
        rows: [{ text: 'b'.repeat(51) }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatTableResults(data)).toContain(`| ${'b'.repeat(47)}... |`);
    });

    it('should stringify long array values instead of string-truncating them', () => {
      const arr = Array.from({ length: 60 }, (_, i) => i);
      const data: QueryResult = {
        rows: [{ data: arr }],
        rowCount: 1,
        fields: ['data'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatTableResults(data)).toContain(JSON.stringify(arr));
    });
  });

  // ============================================================================
  // formatCondensedTableResults
  // ============================================================================

  describe('formatCondensedTableResults', () => {
    it('should return no results message for empty rows', () => {
      const data: QueryResult = {
        rows: [],
        rowCount: 0,
        fields: ['id'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toBe('No results.\n');
    });

    it('should return no columns message for empty fields', () => {
      const data: QueryResult = {
        rows: [{}],
        rowCount: 1,
        fields: [],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toBe('No columns.\n');
    });

    it('should format condensed results with default maxRows', () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `user${i}` }));
      const data: QueryResult = {
        rows,
        rowCount: 10,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).toContain('| id | name |');
      expect(result).toContain('... and 7 more rows');
    });

    it('should respect custom maxRows', () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      const data: QueryResult = {
        rows,
        rowCount: 10,
        fields: ['id'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data, 5);
      expect(result).toContain('... and 5 more rows');
    });

    it('should show ... for more than 4 fields', () => {
      const data: QueryResult = {
        rows: [{ a: 1, b: 2, c: 3, d: 4, e: 5 }],
        rowCount: 1,
        fields: ['a', 'b', 'c', 'd', 'e'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).toContain('| ... |');
    });

    it('should not show ... for 4 or fewer fields', () => {
      const data: QueryResult = {
        rows: [{ a: 1, b: 2, c: 3, d: 4 }],
        rowCount: 1,
        fields: ['a', 'b', 'c', 'd'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).not.toContain('| ...');
    });

    it('should truncate long strings at 20 chars', () => {
      const longString = 'a'.repeat(25);
      const data: QueryResult = {
        rows: [{ text: longString }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).toContain('...');
      expect(result).not.toContain(longString);
    });

    it('should handle NULL values', () => {
      const data: QueryResult = {
        rows: [{ val: null }],
        rowCount: 1,
        fields: ['val'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).toContain('NULL');
    });

    it('should handle object values', () => {
      const data: QueryResult = {
        rows: [{ data: { key: 'v' } }],
        rowCount: 1,
        fields: ['data'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).toContain('{"key":"v"}');
    });

    it('should not show more rows when all fit', () => {
      const data: QueryResult = {
        rows: [{ id: 1 }, { id: 2 }],
        rowCount: 2,
        fields: ['id'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).not.toContain('more rows');
    });

    it('should render the exact condensed table for 4 or fewer fields', () => {
      const data: QueryResult = {
        rows: [{ a: 'x', b: 2 }],
        rowCount: 1,
        fields: ['a', 'b'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toBe('| a | b |\n|---|---|\n| x | 2 |\n\n');
    });

    it('should render the exact condensed table at exactly 4 fields (boundary)', () => {
      const data: QueryResult = {
        rows: [{ a: 'x', b: 2, c: 3, d: 4 }],
        rowCount: 1,
        fields: ['a', 'b', 'c', 'd'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toBe(
        '| a | b | c | d |\n|---|---|---|---|\n| x | 2 | 3 | 4 |\n\n'
      );
    });

    it('should render the exact condensed table for more than 4 fields', () => {
      const data: QueryResult = {
        rows: [{ a: 'v1', b: 2, c: 3, d: 4, e: 5 }],
        rowCount: 1,
        fields: ['a', 'b', 'c', 'd', 'e'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toBe(
        '| a | b | c | d | ... |\n|---|---|---|---|---|\n| v1 | 2 | 3 | 4 | ... |\n\n'
      );
    });

    it('should not truncate strings of exactly 20 chars', () => {
      const s = 'c'.repeat(20);
      const data: QueryResult = {
        rows: [{ text: s }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = formatCondensedTableResults(data);
      expect(result).toContain(`| ${s} |`);
      expect(result).not.toContain('...');
    });

    it('should truncate a 21-char string to 17 chars plus ellipsis', () => {
      const data: QueryResult = {
        rows: [{ text: 'c'.repeat(21) }],
        rowCount: 1,
        fields: ['text'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toContain(`| ${'c'.repeat(17)}... |`);
    });

    it('should render NULL for undefined values', () => {
      const data: QueryResult = {
        rows: [{ id: 1 }],
        rowCount: 1,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toContain('| 1 | NULL |');
    });

    it('should stringify long array values instead of string-truncating them', () => {
      const arr = Array.from({ length: 25 }, (_, i) => i);
      const data: QueryResult = {
        rows: [{ data: arr }],
        rowCount: 1,
        fields: ['data'],
        truncated: false,
        execution_time_ms: 10,
      };

      expect(formatCondensedTableResults(data)).toContain(JSON.stringify(arr));
    });
  });

  // ============================================================================
  // formatDatabaseSummary
  // ============================================================================

  describe('formatDatabaseSummary', () => {
    it('should format basic database summary', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);

      expect(result).toContain('**mydb** (mysql)');
      expect(result).toContain('Full access mode');
      expect(result).toContain('MCP configurable: no');
      expect(result).toContain('Schema not yet captured');
    });

    it('should show host when present', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        host: 'localhost:3306',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('localhost:3306');
    });

    it('should show SSH tunnel when enabled', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: true,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('SSH tunnel enabled');
    });

    it('should show SSL when enabled', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: true,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('SSL enabled');
    });

    it('should show SELECT-only mode details', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: true,
        mcp_configurable: false,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('SELECT-only mode');
      expect(result).toContain('production safe');
      expect(result).toContain('SELECT, WITH, SHOW, EXPLAIN, DESCRIBE');
      expect(result).toContain('INSERT, UPDATE, DELETE, DROP, CREATE, ALTER');
    });

    it('says the database role has not been checked before Argos connects', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mssql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: true,
        mcp_configurable: false,
        schema_cached: false,
      };
      expect(formatDatabaseSummary(db)).toContain('Database role: not checked yet');
    });

    it('warns under SELECT-only when the role can write', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mssql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: true,
        mcp_configurable: false,
        schema_cached: false,
        privileges: {
          canWrite: true,
          principal: 'dbo',
          reasons: ['db_owner'],
          notes: [],
          checkedAt: 'now',
        },
      };
      expect(formatDatabaseSummary(db)).toContain(
        ' Warning: select_only is on, but this connection can write as dbo (db_owner).'
      );
    });

    it('should show MCP configurable when true', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: true,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('MCP configurable: yes');
    });

    it('should show schema info when cached', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: true,
        schema_info: {
          table_count: 10,
          view_count: 2,
          total_columns: 50,
        },
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('10 tables');
      expect(result).toContain('50 columns');
    });

    it('should show schema not captured when not cached', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: false,
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('Schema not yet captured');
    });

    it('should show schema not captured when cached but no schema_info', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: true,
        // no schema_info
      };

      const result = formatDatabaseSummary(db);
      expect(result).toContain('Schema not yet captured');
    });

    it('should render the exact minimal summary with no optional lines', () => {
      const db: DatabaseListItem = {
        name: 'mydb',
        type: 'mysql',
        ssh_enabled: false,
        ssl_enabled: false,
        select_only_mode: false,
        mcp_configurable: false,
        schema_cached: false,
      };

      expect(formatDatabaseSummary(db)).toBe(
        ' **mydb** (mysql)\n' +
          ' Security: Full access mode (use with caution)\n' +
          ' MCP configurable: no (manual config only)\n' +
          ' Schema not yet captured\n' +
          '\n'
      );
    });

    it('should format all features together', () => {
      const db: DatabaseListItem = {
        name: 'production',
        type: 'postgresql',
        host: 'db.example.com',
        ssh_enabled: true,
        ssl_enabled: true,
        select_only_mode: true,
        mcp_configurable: true,
        schema_cached: true,
        schema_info: {
          table_count: 25,
          view_count: 5,
          total_columns: 200,
        },
      };

      const result = formatDatabaseSummary(db);

      expect(result).toContain('**production** (postgresql)');
      expect(result).toContain('db.example.com');
      expect(result).toContain('SSH tunnel enabled');
      expect(result).toContain('SSL enabled');
      expect(result).toContain('SELECT-only mode');
      expect(result).toContain('MCP configurable: yes');
      expect(result).toContain('25 tables');
      expect(result).toContain('200 columns');
    });
  });
});
