# Monitoring and Observability Setup

This directory contains comprehensive examples for monitoring, logging, and observability of Argos deployments. Learn how to set up production-grade monitoring, alerting, and performance tracking.

## Directory Structure

```
monitoring-setup/
|-- README.md # This file
|-- prometheus/ # Prometheus monitoring setup
| |-- prometheus.yml # Prometheus configuration
| |-- argos-rules.yml # Alerting rules
| |-- docker-compose.yml # Prometheus stack
| \-- README.md # Prometheus setup guide
|-- grafana/ # Grafana dashboards and config
| |-- dashboards/ # Pre-built dashboards
| | |-- argos-overview.json # Main overview dashboard
| | |-- database-performance.json # Database performance metrics
| | |-- query-analytics.json # Query analysis dashboard
| | \-- security-monitoring.json # Security events dashboard
| |-- grafana.ini # Grafana configuration
| |-- datasources.yml # Data source configuration
| \-- README.md # Grafana setup guide
|-- logging/ # Centralized logging setup
| |-- elasticsearch/ # Elasticsearch configuration
| |-- logstash/ # Logstash pipeline config
| |-- kibana/ # Kibana dashboards
| |-- fluentd/ # Fluentd logging config
| \-- README.md # Logging setup guide
|-- alerts/ # Alerting configurations
| |-- alertmanager.yml # Alertmanager configuration
| |-- notification-templates/ # Custom alert templates
| |-- webhook-handlers/ # Custom webhook handlers
| \-- README.md # Alerting setup guide
|-- health-checks/ # Health monitoring scripts
| |-- health-check-script.js # Node.js health checker
| |-- health-check-script.py # Python health checker
| |-- monitoring-agent.js # Custom monitoring agent
| \-- README.md # Health check guide
|-- performance/ # Performance monitoring
| |-- apm-setup.js # Application Performance Monitoring
| |-- query-profiler.js # Query performance profiler
| |-- resource-monitor.js # System resource monitoring
| \-- README.md # Performance monitoring guide
|-- docker-compose-monitoring.yml # Complete monitoring stack
|-- kubernetes-monitoring/ # Kubernetes monitoring manifests
| |-- prometheus-operator.yml # Prometheus operator setup
| |-- grafana-deployment.yml # Grafana deployment
| |-- service-monitor.yml # Argos monitoring
| \-- README.md # Kubernetes monitoring guide
\-- troubleshooting.md # Monitoring troubleshooting guide
```

## Monitoring Overview

### What We Monitor

#### 1. Application Metrics
- **Request/Response**: Query count, response times, error rates
- **Connection Pool**: Active connections, pool usage, connection errors 
- **Security**: Failed authentication attempts, blocked queries
- **Performance**: Query execution times, result set sizes

#### 2. Database Metrics
- **Connectivity**: Connection status, connection times
- **Performance**: Query performance, slow queries
- **Resource Usage**: Connection count, active queries
- **Schema Changes**: Structure modifications, permission changes

#### 3. System Metrics
- **CPU/Memory**: Resource utilization, memory leaks
- **Network**: Connection latency, bandwidth usage
- **Disk**: Log file sizes, storage usage
- **Process**: Process health, restart counts

#### 4. Business Metrics
- **Usage Patterns**: Most queried tables, active users
- **Data Quality**: Query success rates, data validation results
- **Compliance**: Access audit trails, permission changes

## Quick Start

### 1. Basic Monitoring Stack
```bash
# Start the complete monitoring stack
docker-compose -f docker-compose-monitoring.yml up -d

# Access dashboards
# Grafana: http://localhost:3000 (admin/admin)
# Prometheus: http://localhost:9090
# AlertManager: http://localhost:9093
```

### 2. Production Kubernetes Setup
```bash
# Deploy monitoring stack to Kubernetes
kubectl apply -f kubernetes-monitoring/

# Check deployment status
kubectl get pods -n monitoring

# Access Grafana
kubectl port-forward svc/grafana 3000:80 -n monitoring
```

### 3. Custom Health Checks
```bash
# Run health check script
node health-checks/health-check-script.js

# Set up monitoring agent
npm install
node health-checks/monitoring-agent.js
```

## Monitoring Components

### 1. Prometheus Stack
**Purpose**: Time-series metrics collection and alerting

**Components**:
- Prometheus server for metrics storage
- Alertmanager for alert routing
- Node Exporter for system metrics
- Custom exporters for Argos metrics

**Key Metrics**:
```
argos_queries_total{database, status}
argos_query_duration_seconds{database}
argos_connections_active{database}
argos_errors_total{type, database}
```

### 2. Grafana Dashboards
**Purpose**: Visualization and real-time monitoring

**Dashboards**:
- **Overview**: High-level system health and performance
- **Database Performance**: Per-database metrics and trends
- **Query Analytics**: Query patterns and optimization insights
- **Security Monitoring**: Access patterns and security events

### 3. Centralized Logging
**Purpose**: Log aggregation, search, and analysis

**Stack Options**:
- **ELK Stack**: Elasticsearch, Logstash, Kibana
- **EFK Stack**: Elasticsearch, Fluentd, Kibana 
- **Loki Stack**: Grafana Loki, Promtail, Grafana

**Log Categories**:
- Application logs (INFO, WARN, ERROR)
- Query logs (SQL statements, performance)
- Security logs (authentication, authorization)
- System logs (connections, errors)

### 4. Alerting
**Purpose**: Proactive issue notification

**Alert Types**:
- **Critical**: Service down, database unreachable
- **Warning**: High error rate, performance degradation
- **Info**: Configuration changes, maintenance events

**Notification Channels**:
- Email, Slack, PagerDuty
- Webhooks, SMS, custom integrations

## Configuration Examples

### Basic Prometheus Configuration
```yaml
global:
 scrape_interval: 15s
 evaluation_interval: 15s

scrape_configs:
 - job_name: 'argos'
 static_configs:
 - targets: ['localhost:3001']
 metrics_path: '/metrics'
 scrape_interval: 10s
```

### Grafana Dashboard Query Examples
```
# Query success rate
rate(argos_queries_total{status="success"}[5m]) / 
rate(argos_queries_total[5m]) * 100

# Average query duration
avg(argos_query_duration_seconds) by (database)

# Connection pool utilization
argos_connections_active / argos_connections_max * 100
```

### Log Configuration
```javascript
// Winston logger configuration
const winston = require('winston');

const logger = winston.createLogger({
 level: 'info',
 format: winston.format.combine(
 winston.format.timestamp(),
 winston.format.errors({ stack: true }),
 winston.format.json()
 ),
 defaultMeta: { service: 'argos' },
 transports: [
 new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
 new winston.transports.File({ filename: 'logs/combined.log' }),
 new winston.transports.Console({
 format: winston.format.simple()
 })
 ]
});
```

## Deployment Scenarios

### 1. Development Environment
- Basic health checks
- Log file monitoring
- Simple alerting to development team
- Resource usage tracking

### 2. Staging Environment 
- Full monitoring stack
- Performance baseline establishment
- Load testing metrics
- Integration testing monitoring

### 3. Production Environment
- High-availability monitoring
- Comprehensive alerting
- Performance optimization
- Compliance and audit logging
- Disaster recovery monitoring

## Key Performance Indicators (KPIs)

### Operational KPIs
- **Uptime**: 99.9% availability target
- **Response Time**: < 100ms average query response
- **Error Rate**: < 0.1% query failure rate
- **Connection Success**: > 99.5% connection establishment

### Business KPIs
- **Query Volume**: Queries per minute/hour/day
- **User Activity**: Active users, peak usage times
- **Data Access Patterns**: Most accessed tables/databases
- **Performance Trends**: Month-over-month improvements

### Security KPIs
- **Failed Authentication**: Track and alert on patterns
- **Blocked Queries**: Monitor security policy effectiveness
- **Access Compliance**: Audit trail completeness
- **Permission Changes**: Track privilege modifications

## Best Practices

### 1. Monitoring Strategy
- **Start Simple**: Begin with basic health checks and core metrics
- **Iterate**: Add complexity as needs become clear
- **Automate**: Use infrastructure as code for reproducible setups
- **Document**: Maintain runbooks for common scenarios

### 2. Alerting Guidelines
- **Meaningful Alerts**: Avoid alert fatigue with actionable alerts
- **Proper Escalation**: Define clear escalation paths
- **Context**: Include relevant context in alert messages
- **Testing**: Regularly test alert delivery and response

### 3. Performance Optimization
- **Baseline**: Establish performance baselines
- **Trends**: Monitor trends over time, not just current values
- **Capacity Planning**: Use metrics for future capacity planning
- **Bottleneck Identification**: Focus on constraining factors

### 4. Security Monitoring
- **Real-time**: Security events need immediate attention
- **Patterns**: Look for patterns that indicate attacks
- **Compliance**: Ensure monitoring meets regulatory requirements
- **Retention**: Maintain appropriate log retention periods

## Troubleshooting Common Issues

### High CPU Usage
1. Check query complexity metrics
2. Review connection pool settings
3. Analyze slow query logs
4. Monitor garbage collection patterns

### Memory Leaks
1. Monitor heap usage trends
2. Check connection pool cleanup
3. Review result set handling
4. Analyze object retention

### Database Connection Issues
1. Monitor connection pool exhaustion
2. Check network latency metrics
3. Review database server capacity
4. Analyze connection timeout patterns

### Performance Degradation
1. Compare current vs. historical metrics
2. Identify query performance changes
3. Check resource utilization trends
4. Review recent configuration changes

## Integration with Argos

### Built-in Monitoring Support
Argos includes built-in monitoring capabilities:

```javascript
// Enable metrics endpoint
const server = new SQLMCPServer({
 enableMetrics: true,
 metricsPort: 3001,
 metricsPath: '/metrics'
});

// Custom metric collection
server.on('queryExecuted', (event) => {
 queryCounter.inc({
 database: event.database,
 status: event.success ? 'success' : 'error'
 });
});
```

### Custom Metrics
Add custom metrics for specific use cases:

```javascript
// Custom business metrics
const businessMetrics = {
 userQueries: new prometheus.Counter({
 name: 'user_queries_total',
 help: 'Total queries by user',
 labelNames: ['user', 'department']
 }),
 
 dataVolume: new prometheus.Histogram({
 name: 'query_result_size_bytes',
 help: 'Size of query results',
 buckets: [100, 1000, 10000, 100000, 1000000]
 })
};
```

## Getting Started

1. **Choose Your Stack**: Select monitoring tools based on your infrastructure
2. **Start with Basics**: Implement health checks and basic metrics first
3. **Add Visualization**: Set up Grafana dashboards for key metrics
4. **Configure Alerts**: Set up essential alerts for critical issues
5. **Iterate and Improve**: Add more sophisticated monitoring as needed

## Resources

- **Prometheus Documentation**: https://prometheus.io/docs/
- **Grafana Documentation**: https://grafana.com/docs/
- **Monitoring Best Practices**: [../../docs/operations/monitoring.md](../../docs/operations/monitoring.md)
- **Performance Tuning**: [../../docs/operations/performance-tuning.md](../../docs/operations/performance-tuning.md)
- **Security Hardening**: [../../docs/operations/security-hardening.md](../../docs/operations/security-hardening.md)

Remember: Effective monitoring is about finding the right balance between comprehensive coverage and actionable insights. Start with the basics and evolve your monitoring strategy based on actual operational needs.