# Claude Integrations Examples

This directory contains comprehensive examples for integrating Argos with various Claude interfaces and workflows. Learn how to configure, optimize, and troubleshoot Claude integrations.

## Directory Structure

```
claude-integrations/
|-- README.md # This file
|-- claude-api/ # Claude API integration examples
| |-- python-example.py # Python API integration
| |-- javascript-example.js # Node.js API integration
| |-- requirements.txt # Python dependencies
| \-- package.json # Node.js dependencies
|-- workflows/ # Common workflow examples
| |-- data-analysis-prompts.md # Data analysis workflows
| |-- reporting-templates.md # Report generation templates
| |-- database-administration.md # DBA task workflows
| \-- business-intelligence.md # BI and analytics workflows
|-- prompt-engineering/ # Optimized prompts for SQL tasks
| |-- schema-exploration.md # Database schema discovery
| |-- query-optimization.md # SQL query optimization
| |-- data-validation.md # Data quality and validation
| \-- security-analysis.md # Security-focused queries
\-- automation/ # Automation examples
 |-- scheduled-reports.js # Automated reporting
 |-- data-monitoring.py # Data monitoring scripts
 \-- alert-systems.md # Alert and notification systems
```

## Integration Types

### 1. Claude Code Integration
Register the server with `claude mcp add` for interactive database queries and analysis. See the [Claude Integration Tutorial](../../docs/tutorials/03-claude-integration.md) for the full walkthrough.

**Features:**
- Real-time database connectivity
- Interactive query building
- Schema exploration
- Data visualization assistance

### 2. Claude API Integration
Programmatic integration using Claude API for automated database operations and reporting.

**Features:**
- Batch query processing
- Automated report generation
- Scheduled data analysis
- Custom workflow automation

### 3. Workflow Templates
Pre-built workflows for common database tasks and analysis patterns.

**Categories:**
- **Data Analysis**: Exploratory data analysis, statistical queries, trend analysis
- **Reporting**: Automated reports, dashboards, KPI monitoring
- **Administration**: Database maintenance, user management, performance monitoring
- **Business Intelligence**: OLAP queries, data warehousing, analytics

## Quick Start Guide

### Claude Code Setup
1. **Install and configure Argos**:
 ```bash
 npm install
 npm run build
 ```

2. **Configure Claude Code**:
 ```bash
 # Copy the basic configuration
 claude mcp add argos --scope user -- node "$(pwd)/dist/cli.js" serve --config "$(pwd)/config.ini"
 
 # Edit paths to match your installation
 ```

3. **Test the integration**:
 - Restart Claude Code
 - Ask: "What databases do you have access to?"

### API Integration Setup
1. **Python example**:
 ```bash
 pip install -r examples/claude-integrations/claude-api/requirements.txt
 python examples/claude-integrations/claude-api/python-example.py
 ```

2. **Node.js example**:
 ```bash
 cd examples/claude-integrations/claude-api
 npm install
 node javascript-example.js
 ```

## Common Use Cases

### 1. Interactive Data Exploration
Ask Claude to help explore your database:
- "Show me the structure of my database"
- "What are the relationships between tables?"
- "Find any data quality issues in the user table"

### 2. Automated Reporting
Generate reports automatically:
- Daily sales summaries
- User activity reports
- Performance monitoring dashboards

### 3. Query Optimization
Get help optimizing database queries:
- "Analyze this query for performance issues"
- "Suggest indexes for better performance"
- "Rewrite this query to be more efficient"

### 4. Data Analysis
Perform complex data analysis:
- Statistical analysis and trends
- Customer segmentation
- Business metrics calculation

## Best Practices

### Security
- Use SELECT-only mode for production databases
- Configure appropriate security limits
- Regularly review access patterns
- Monitor query complexity and performance

### Performance
- Set appropriate timeout values
- Limit result set sizes
- Use indexes for frequently queried columns
- Monitor resource usage

### Workflow Optimization
- Create reusable prompt templates
- Document common query patterns
- Establish data governance procedures
- Train users on effective prompting

## Configuration Examples

### Basic Claude Code Config
```json
{
 "mcpServers": {
 "argos": {
 "command": "node",
 "args": ["/path/to/argos/dist/cli.js", "serve"]
 }
 }
}
```

### Advanced Configuration
```json
{
 "mcpServers": {
 "argos": {
 "command": "node",
 "args": ["/path/to/argos/dist/cli.js", "serve"],
 "env": {
 "CONFIG_PATH": "/path/to/config.ini",
 "LOG_LEVEL": "info",
 "NODE_ENV": "production"
 }
 }
 }
}
```

## Troubleshooting

### Common Issues
1. **Server not connecting**: Check paths and permissions
2. **Database connection errors**: Verify config.ini settings
3. **Query failures**: Check security settings and permissions
4. **Performance issues**: Review timeout and limit settings

### Debug Steps
1. Check Claude Code logs
2. Verify MCP server startup
3. Test database connections independently
4. Review security and performance settings

## Examples by Use Case

| Use Case | Files | Description |
|----------|-------|-------------|
| **Claude Code Setup** | `../../docs/tutorials/03-claude-integration.md` | `claude mcp add` walkthrough |
| **API Automation** | `claude-api/` | Programmatic integration examples |
| **Data Analysis** | `workflows/data-analysis-prompts.md` | Analysis workflow templates |
| **Reporting** | `workflows/reporting-templates.md` | Report generation examples |
| **Query Optimization** | `prompt-engineering/query-optimization.md` | SQL optimization prompts |
| **Monitoring** | `automation/data-monitoring.py` | Automated monitoring scripts |

## Support and Resources

- **Documentation**: [../../docs/README.md](../../docs/README.md)
- **Troubleshooting**: [../../docs/guides/troubleshooting-guide.md](../../docs/guides/troubleshooting-guide.md)
- **Security Guide**: [../../docs/guides/security-guide.md](../../docs/guides/security-guide.md)
- **Performance Tuning**: [../../docs/operations/performance-tuning.md](../../docs/operations/performance-tuning.md)

## Contributing

Help improve these examples by:
1. Adding new integration patterns
2. Documenting best practices
3. Sharing workflow templates
4. Reporting issues and solutions

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.