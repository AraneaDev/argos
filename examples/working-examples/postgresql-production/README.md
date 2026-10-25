# PostgreSQL Production Setup - Working Example

**Objective**: Demonstrate production-ready PostgreSQL configuration with security, monitoring, and real-world data patterns.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 22+ installed 
- argos package installed (`npm install -g argos`)
- At least 512MB RAM available for containers

## Try It Now!

### One-Command Setup
```bash
# Complete automated setup and demo
./run-production-demo.sh
```

### Step-by-Step Manual Setup
```bash
# 1. Start PostgreSQL with sample data
docker-compose up -d

# 2. Wait for database initialization
./wait-for-postgres.sh

# 3. Setup Argos configuration 
./setup-config.sh

# 4. Start Argos
./start-server.sh

# 5. Run comprehensive tests
./test-production-queries.sh

# 6. Test monitoring and performance
./test-monitoring.sh

# 7. Cleanup
./cleanup.sh
```

## What This Demo Shows

### Production-Grade Features
- **Security**: SELECT-only mode, readonly user, SSL connections
- **Performance**: Connection pooling, query optimization, monitoring
- **Monitoring**: Health checks, performance metrics, query analytics
- **Scalability**: Multi-schema design, indexed queries, view optimization

### Database Schema
- **application** schema: Core business tables (users, products, orders)
- **analytics** schema: Pre-computed views and aggregations 
- **audit** schema: Change tracking and compliance logging
- **monitoring** schema: Performance and health metrics

### Sample Data Includes
- 1,000+ realistic users across departments
- 10,000+ orders with varied patterns
- 100+ products with categories
- Historical data spanning 2 years
- Realistic business relationships

## Architecture Demonstrated

```
Claude Code
 v
Argos (SELECT-only)
 v
PostgreSQL (Docker)
|-- application schema (business data)
|-- analytics schema (views & reports)
|-- audit schema (change tracking) 
\-- monitoring schema (metrics)
```

## Files in This Demo

- `README.md` - This documentation
- `run-production-demo.sh` - Complete automated demo
- `docker-compose.yml` - PostgreSQL with monitoring stack
- `init-scripts/` - Database initialization
 - `01-create-schemas.sql` - Schema creation
 - `02-create-tables.sql` - Table definitions
 - `03-create-views.sql` - Analytics views
 - `04-insert-sample-data.sql` - Realistic test data
 - `05-create-indexes.sql` - Performance indexes
 - `06-create-users.sql` - Security setup
- `config/` - Configuration files
 - `production.ini` - Argos config
 - `readonly-config.ini` - Readonly-only config
 - `monitoring-config.ini` - Monitoring enhanced config
- `scripts/` - Utility scripts
 - `setup-config.sh` - Configuration setup
 - `wait-for-postgres.sh` - Startup wait script
 - `start-server.sh` - Server startup
 - `test-production-queries.sh` - Query tests
 - `test-monitoring.sh` - Monitoring tests
 - `cleanup.sh` - Environment cleanup
- `monitoring/` - Monitoring configuration
 - `prometheus.yml` - Metrics collection
 - `grafana-dashboard.json` - Visualization
- `claude-integration/` - Claude Code setup
 - `production-config.json` - Production integration
 - `development-config.json` - Development integration
 - `sample-prompts.md` - Example queries for Claude

## Security Features Demonstrated

### Database Security
- **Readonly User**: Limited to SELECT permissions only
- **Schema Isolation**: Separate schemas for different access levels
- **Connection Encryption**: SSL/TLS for all connections
- **Network Security**: Database only accessible via docker network

### Application Security
- **Query Validation**: SQL injection prevention
- **Complexity Limits**: Resource usage protection
- **Result Limits**: Memory protection
- **Audit Logging**: All queries logged for compliance

### Example Security Configuration
```ini
[database.production]
type=postgresql
host=localhost
port=5432
database=production_app
username=readonly_user
password=readonly_secure_password
ssl=require
select_only=true
timeout=30000

[security]
max_joins=15
max_subqueries=8
max_unions=5
max_complexity_score=200
max_query_length=50000

[extension]
max_rows=5000
query_timeout=60000
max_batch_size=20
debug=false
```

## Performance Features

### Query Optimization
- Strategic indexes on frequently queried columns
- Materialized views for complex aggregations
- Query plan analysis and recommendations
- Connection pooling and reuse

### Monitoring Integration
- Query execution time tracking
- Slow query identification
- Connection pool monitoring
- Resource usage metrics

### Sample Performance Queries
```sql
-- Optimized department analytics
SELECT * FROM analytics.department_performance
WHERE reporting_month >= CURRENT_DATE - INTERVAL '6 months';

-- Efficient product search
SELECT * FROM application.products 
WHERE search_vector @@ to_tsquery('laptop & wireless')
ORDER BY popularity_score DESC;

-- Fast user lookup with caching
SELECT u.*, d.name as department_name
FROM application.users u
JOIN application.departments d ON u.department_id = d.id
WHERE u.email = $1;
```

## Business Use Cases Demonstrated

### Analytics & Reporting
- Monthly sales reports by department
- Customer segmentation analysis 
- Product performance tracking
- Revenue trend analysis

### Operational Queries
- Real-time order status tracking
- Inventory level monitoring
- Customer support ticket analysis
- User activity tracking

### Compliance & Auditing
- Data access audit trails
- Change tracking for sensitive data
- Regulatory reporting queries
- Security event monitoring

## Claude Integration Examples

Once set up, try these queries with Claude:

### Business Intelligence
> "What were our top 5 best-selling products last month?"
> "Show me the revenue trend by department for the past quarter"
> "Which customers have the highest lifetime value?"

### Operational Analytics 
> "How many pending orders do we have right now?"
> "What's our average order fulfillment time this week?"
> "Show me users who haven't placed orders in 90 days"

### Performance Analysis
> "Which queries are running slowly in our system?"
> "What's our database connection usage pattern?"
> "Show me the most frequently accessed tables"

## Testing & Validation

### Automated Test Suite
The demo includes comprehensive tests:

```bash
./test-production-queries.sh
```

Tests cover:
- Database connectivity and authentication
- Schema access permissions
- Query execution performance
- Complex analytical queries
- Error handling and validation
- Security constraint enforcement
- Monitoring data collection

### Performance Benchmarks
Expected performance on modern hardware:
- Simple queries: < 50ms
- Complex analytical queries: < 500ms 
- Schema operations: < 100ms
- Connection establishment: < 200ms

### Load Testing
```bash
# Simulate concurrent usage
./scripts/load-test.sh --concurrent-users=10 --duration=60s
```

## Customization Guide

### Adapting for Your Data
1. **Update Schema**: Modify `init-scripts/02-create-tables.sql`
2. **Add Sample Data**: Update `init-scripts/04-insert-sample-data.sql`
3. **Configure Views**: Customize `init-scripts/03-create-views.sql`
4. **Adjust Security**: Update user permissions in `init-scripts/06-create-users.sql`

### Environment Variations
- **Development**: Use `development-config.ini` with relaxed security
- **Staging**: Use `staging-config.ini` with production-like settings 
- **Production**: Use `production-config.ini` with full security

### Scaling Considerations
- **Connection Pooling**: Configure appropriate pool sizes
- **Resource Limits**: Adjust memory and CPU limits
- **Network**: Configure SSL certificates for production
- **Backup**: Implement automated backup strategies

## Troubleshooting

### Common Issues

#### Container Startup Problems
```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs postgres

# Restart containers
docker-compose down && docker-compose up -d
```

#### Connection Issues 
```bash
# Test database connectivity
docker-compose exec postgres pg_isready

# Test with readonly user
docker-compose exec postgres psql -U readonly_user -d production_app -c "SELECT 1"
```

#### Performance Issues
```bash
# Check query performance
./scripts/analyze-queries.sh

# Monitor resource usage
docker stats
```

#### Permission Issues
```bash
# Verify user permissions
docker-compose exec postgres psql -U postgres -d production_app \
 -c "SELECT * FROM information_schema.role_table_grants WHERE grantee='readonly_user'"
```

## Monitoring Dashboard

Access the monitoring dashboard:
```bash
# Start monitoring stack
docker-compose -f docker-compose-monitoring.yml up -d

# Access Grafana
open http://localhost:3000
# Username: admin, Password: admin
```

### Key Metrics Tracked
- Query execution times
- Connection pool usage 
- Error rates and patterns
- Resource utilization
- Security events

## Learning Outcomes

After completing this demo, you'll understand:

- Production PostgreSQL configuration best practices
- Security implementation for database access
- Performance optimization techniques
- Monitoring and observability setup
- Claude integration for business intelligence
- Scaling considerations for real-world usage

## Related Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Argos Security Guide](../../../docs/guides/security-guide.md)
- [Performance Tuning Guide](../../../docs/operations/performance-tuning.md)
- [Monitoring Setup](../../../docs/operations/monitoring.md)

## Success Checklist

- [ ] PostgreSQL containers start successfully
- [ ] Database initialized with sample data
- [ ] Readonly user created with proper permissions
- [ ] Argos connects and validates config
- [ ] All test queries execute successfully 
- [ ] Performance benchmarks meet expectations
- [ ] Monitoring data collection works
- [ ] Claude Code integration configured
- [ ] Security constraints properly enforced
- [ ] Cleanup script removes all containers and data

---

** Ready to start?** Run `./run-production-demo.sh` to begin the complete demonstration!