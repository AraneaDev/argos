import type { MCPToolResponse } from '../../types/index.js';
import type { ToolHandlerContext } from './types.js';

interface GetMetricsArgs {
  database?: string;
}

/** sql_get_metrics: query metrics for one database, or for all of them. */
export async function handleGetMetrics(
  args: GetMetricsArgs,
  ctx: ToolHandlerContext
): Promise<MCPToolResponse> {
  const snapshot = args.database
    ? ctx.metricsManager.getSnapshot(args.database)
    : ctx.metricsManager.getSnapshot();
  const text = JSON.stringify(snapshot, null, 2);
  return {
    content: [{ type: 'text', text }],
    _meta: { progressToken: null },
  };
}
