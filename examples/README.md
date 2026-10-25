# Argos Examples

This directory contains comprehensive examples for deploying, configuring, and integrating Argos in various environments. From basic setups to enterprise deployments, these examples help you get started quickly and scale effectively.

## Directory Structure

```
examples/
|-- README.md # This file
|-- basic-setup/ # Quick start configurations
| |-- simple-sqlite.ini # Minimal SQLite setup
| |-- single-postgresql.ini # Basic PostgreSQL config
| |-- single-mysql.ini # Basic MySQL config
| |-- multiple-databases.ini # Multi-database setup
| |-- docker-compose-demo.yml # Docker demo environment
| | |-- test-queries.sql # Sample test queries
| \-- init-scripts/ # Database initialization scripts
|-- claude-integrations/ # Claude integration examples
| | |-- claude-api/ # API integration examples
| |-- workflows/ # Common workflow templates
| |-- prompt-engineering/ # Optimized prompts
| \-- automation/ # Automation scripts
|-- custom-adapters/ # Database adapter examples
| |-- adapter-template.ts # Base adapter template
| |-- oracle-adapter/ # Oracle Database example
| |-- redis-adapter/ # Redis NoSQL example
| |-- csv-adapter/ # CSV file adapter
| \-- snowflake-adapter/ # Snowflake DW adapter
|-- monitoring-setup/ # Monitoring and observability
| |-- prometheus/ # Prometheus configuration
| |-- grafana/ # Grafana dashboards
| |-- logging/ # Centralized logging
| |-- alerts/ # Alerting setup
| |-- health-checks/ # Health monitoring scripts
| \-- docker-compose-monitoring.yml # Complete monitoring stack
|-- enterprise-deployment/ # Production deployment examples
| \-- kubernetes/ # Kubernetes manifests
\-- interactive-tools/ # Interactive configuration tools
```

## Getting Started

### 1. Quick Start (5 minutes)
```bash
# Use SQLite for immediate testing
cp examples/basic-setup/simple-sqlite.ini config.ini
mkdir -p data
npm start
```

### 2. Database Integration (10 minutes)
```bash
# Configure your database
cp examples/basic-setup/single-postgresql.ini config.ini
# Edit config.ini with your database details
npm start
```

### 3. Claude Code Integration (2 minutes)
```bash
# Register the built server with Claude Code
claude mcp add argos --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config "$(pwd)/config.ini"
claude mcp list
```

### 4. Production Monitoring (15 minutes)
```bash
# Start monitoring stack
docker-compose -f examples/monitoring-setup/docker-compose-monitoring.yml up -d
# Access Grafana at http://localhost:3000
```

## Example Categories

### Basic Setup Examples
**Perfect for**: New users, quick testing, development

- **Simple SQLite**: Zero-configuration local database
- **Single Database**: PostgreSQL, MySQL connection examples
- **Multiple Databases**: Multi-environment configurations
- **Docker Demo**: Containerized test environment
- **Claude Integration**: Desktop app integration

### Claude Integration Examples
**Perfect for**: Workflow optimization, automation, AI-powered analysis

- **Desktop Configuration**: Multiple setup scenarios
- **API Integration**: Python and Node.js examples
- **Workflow Templates**: Data analysis, reporting, administration
- **Prompt Engineering**: Optimized queries and patterns
- **Automation Scripts**: Scheduled reports, monitoring

### Custom Adapter Examples
**Perfect for**: Extending database support, specialized systems

- **Adapter Template**: Base template for new databases
- **Oracle Adapter**: Enterprise database integration
- **Redis Adapter**: NoSQL key-value store support
- **CSV Adapter**: File-based data querying
- **Cloud Adapters**: Snowflake, BigQuery examples

### Monitoring Examples
**Perfect for**: Production deployments, performance optimization

- **Prometheus Stack**: Metrics collection and alerting
- **Grafana Dashboards**: Visualization and monitoring
- **Health Checks**: Automated system verification
- **Log Management**: Centralized logging solutions
- **Performance Monitoring**: Query and system metrics

### Enterprise Deployment
**Perfect for**: Production environments, scalability, high availability

- **Kubernetes**: Container orchestration deployment
- **High Availability**: Load balancing, failover
- **Security Hardening**: Production security measures
- **Backup & Recovery**: Data protection strategies

## Use Case Examples

### Development Team
```bash
# Multi-environment setup for development team
cp examples/basic-setup/multiple-databases.ini config.ini
# Edit with dev, staging, and production databases
# Use SELECT-only mode for production safety
```

### Data Analysis Team
```bash
# Register a read-only analytics database for the team
claude mcp add argos-analytics --scope project -- \
  node "$(pwd)/dist/cli.js" serve --config "$(pwd)/analytics.ini"
# Review workflow templates in examples/claude-integrations/workflows/
```

### DevOps/SRE Team
```bash
# Full monitoring and alerting setup
cd examples/monitoring-setup
docker-compose -f docker-compose-monitoring.yml up -d
# Configure alerts and dashboards
```

### Enterprise Deployment
```bash
# Kubernetes production deployment
kubectl apply -f examples/enterprise-deployment/kubernetes/
# Set up monitoring, backup, and security policies
```

## Common Configurations

### Security-First Setup
```ini
[database.production]
type=postgresql
host=prod-db.company.com
select_only=true # Read-only access
ssl=true # Encrypted connections
timeout=10000 # Conservative timeout

[security]
max_complexity_score=50 # Limit query complexity
max_query_length=5000 # Prevent large queries
```

### Performance-Optimized Setup
```ini
[extension]
max_rows=5000 # Larger result sets
query_timeout=60000 # Extended timeout
max_batch_size=20 # More concurrent queries

[security]
max_joins=20 # Allow complex joins
max_complexity_score=200 # Higher complexity limit
```

### Multi-Environment Setup
```ini
# Production (Read-only)
[database.prod]
type=postgresql
select_only=true
ssl=true

# Development (Full access)
[database.dev]
type=postgresql 
select_only=false
ssl=false

# Testing (Local SQLite)
[database.test]
type=sqlite
file=./test.db
```

## Integration Patterns

### API Integration
```javascript
// Node.js example
const { SQLMCPClient } = require('@modelcontextprotocol/client');
const client = new SQLMCPClient('ws://localhost:3001');

const result = await client.query({
 database: 'production',
 query: 'SELECT COUNT(*) as user_count FROM users',
 params: []
});
```

### Scheduled Reports
```python
# Python automation example
import schedule
import time
from argos_client import SQLMCPClient

def generate_daily_report():
 client = SQLMCPClient('http://localhost:3001')
 result = client.query('production', 'SELECT * FROM daily_stats WHERE date = CURRENT_DATE')
 # Process and send report

schedule.every().day.at("09:00").do(generate_daily_report)
```

### Custom Monitoring
```javascript
// Custom health check
const healthCheck = async () => {
 try {
 const response = await fetch('http://localhost:3001/health');
 const status = response.ok ? 'healthy' : 'unhealthy';
 console.log(`Argos: ${status}`);
 } catch (error) {
 console.error('Health check failed:', error.message);
 }
};

setInterval(healthCheck, 30000); // Check every 30 seconds
```

## Troubleshooting

### Common Issues

1. **Connection Failures**
 - Check database credentials and connectivity
 - Verify firewall rules and network access
 - Review SSL/TLS configuration

2. **Performance Issues**
 - Check query complexity and result set sizes
 - Monitor connection pool usage
 - Review timeout settings

3. **Integration Problems**
 - Verify the paths recorded by `claude mcp get argos` are absolute
 - Check MCP server startup logs
 - Test with simple queries first

### Debug Steps

```bash
# Enable debug logging
export LOG_LEVEL=debug
export DEBUG_QUERIES=true
npm start

# Test individual components
node examples/monitoring-setup/health-checks/health-check-script.js

# Validate configuration
npm run setup -- --test
```

## Contributing

Help improve these examples by:

1. **Adding New Examples**: Share your configurations and use cases
2. **Improving Documentation**: Clarify setup instructions and troubleshooting
3. **Testing**: Verify examples work in different environments
4. **Reporting Issues**: Document problems and solutions

See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed guidelines.

## Support Resources

- **Documentation Hub**: [docs/README.md](../docs/README.md)
- **Installation Guide**: [docs/guides/installation-guide.md](../docs/guides/installation-guide.md)
- **Configuration Reference**: [docs/guides/configuration-guide.md](../docs/guides/configuration-guide.md)
- **Troubleshooting**: [docs/guides/troubleshooting-guide.md](../docs/guides/troubleshooting-guide.md)
- **Security Guide**: [docs/guides/security-guide.md](../docs/guides/security-guide.md)

## What's Next?

After exploring these examples:

1. **Start Simple**: Begin with basic-setup examples
2. **Integrate with Claude**: Set up desktop or API integration
3. **Add Monitoring**: Implement health checks and metrics
4. **Scale Up**: Move to enterprise deployment patterns
5. **Customize**: Create your own adapters and workflows
6. **Optimize**: Fine-tune performance and security settings

## Quick Reference

| Task | Example Directory | Key Files |
|------|------------------|-----------|
| **First Time Setup** | `basic-setup/` | `simple-sqlite.ini` |
| **Production Config** | `basic-setup/` | `multiple-databases.ini` |
| **Claude Code** | `claude-integrations/` | `README.md` |
| **API Integration** | `claude-integrations/claude-api/` | `python-example.py` |
| **Custom Database** | `custom-adapters/` | `adapter-template.ts` |
| **Monitoring** | `monitoring-setup/` | `docker-compose-monitoring.yml` |
| **Health Checks** | `monitoring-setup/health-checks/` | `health-check-script.js` |
| **Enterprise Deploy** | `enterprise-deployment/` | `kubernetes/deployment.yaml` |

Remember: These examples are templates to get you started quickly. Customize them based on your specific requirements, security policies, and operational needs.