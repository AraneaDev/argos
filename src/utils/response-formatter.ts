/**
 * Response Formatting Utilities
 * Pure functions for formatting query results and database summaries
 */

import { describePrivileges } from '../database/privileges.js';
import type { QueryResult, DatabaseListItem, MCPToolResponse } from '../types/index.js';

/**
 * Create a standardized MCP tool response
 */
export function createToolResponse(text: string, isError = false): MCPToolResponse {
  const response: MCPToolResponse = {
    content: [{ type: 'text', text }],
    _meta: { progressToken: null },
  };
  if (isError) {
    response.isError = true;
  }
  return response;
}

/**
 * Format query results as a markdown table
 */
export function formatTableResults(data: QueryResult): string {
  if (data.rows.length === 0) return 'No results returned.\n';

  const fields = data.fields;
  if (fields.length === 0) return 'No columns returned.\n';

  // Create table header
  let table = '| ' + fields.join(' | ') + ' |\n';
  table += '|' + fields.map(() => '---').join('|') + '|\n';

  // Add rows (limit for readability)
  const rowsToShow = Math.min(data.rows.length, 20);
  for (let i = 0; i < rowsToShow; i++) {
    const row = data.rows[i];
    const values = fields.map((field) => {
      let val = row[field];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'string' && val.length > 50) return val.substring(0, 47) + '...';
      if (typeof val === 'object') {
        val = JSON.stringify(val);
      }
      return String(val);
    });
    table += '| ' + values.join(' | ') + ' |\n';
  }

  if (data.rows.length > rowsToShow) {
    table += `\n... and ${data.rows.length - rowsToShow} more rows\n`;
  }

  return table;
}

/**
 * Format condensed table results for batch queries
 */
export function formatCondensedTableResults(data: QueryResult, maxRows = 3): string {
  if (data.rows.length === 0) return 'No results.\n';

  const fields = data.fields;
  if (fields.length === 0) return 'No columns.\n';

  // Create condensed table - show only first few rows
  let table = '| ' + fields.slice(0, 4).join(' | ') + (fields.length > 4 ? ' | ...' : '') + ' |\n';
  table +=
    '|' +
    fields
      .slice(0, 4)
      .map(() => '---')
      .join('|') +
    (fields.length > 4 ? '|---|' : '|') +
    '\n';

  const rowsToShow = Math.min(data.rows.length, maxRows);
  for (let i = 0; i < rowsToShow; i++) {
    const row = data.rows[i];
    const values = fields.slice(0, 4).map((field) => {
      let val = row[field];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'string' && val.length > 20) return val.substring(0, 17) + '...';
      if (typeof val === 'object') {
        val = JSON.stringify(val);
      }
      return String(val);
    });
    if (fields.length > 4) values.push('...');
    table += '| ' + values.join(' | ') + ' |\n';
  }

  if (data.rows.length > rowsToShow) {
    table += `... and ${data.rows.length - rowsToShow} more rows\n`;
  }

  return table + '\n';
}

/**
 * Format a single database summary for list display
 */
export function formatDatabaseSummary(db: DatabaseListItem): string {
  let summary = ` **${db.name}** (${db.type})\n`;
  if (db.host) summary += ` ${db.host}\n`;
  if (db.ssh_enabled) summary += ` SSH tunnel enabled\n`;
  if (db.ssl_enabled) summary += ` SSL enabled\n`;

  if (db.select_only_mode) {
    summary += ` Security: SELECT-only mode (production safe)\n`;
    summary += ` Allows: SELECT, WITH, SHOW, EXPLAIN, DESCRIBE\n`;
    summary += ` Blocks: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER\n`;
    for (const line of describePrivileges(true, db.privileges)) summary += ` ${line}\n`;
  } else {
    summary += ` Security: Full access mode (use with caution)\n`;
  }

  if (db.mcp_configurable) {
    summary += ` MCP configurable: yes\n`;
  } else {
    summary += ` MCP configurable: no (manual config only)\n`;
  }

  if (db.schema_cached && db.schema_info) {
    summary += ` Schema: ${db.schema_info.table_count} tables, ${db.schema_info.total_columns} columns\n`;
  } else {
    summary += ` Schema not yet captured\n`;
  }
  summary += '\n';
  return summary;
}
