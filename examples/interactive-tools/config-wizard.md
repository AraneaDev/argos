# Interactive Configuration Wizard

This interactive tool helps you generate configuration files for the Argos based on your specific requirements.

## Usage

### Web-based Configuration Wizard

```bash
# Start the configuration wizard
npm run config-wizard

# Or using the built distribution
node dist/tools/config-wizard.js
```

This will start a web server at `http://localhost:8080` with an interactive configuration interface.

### Command-line Configuration Wizard

```bash
# Interactive CLI wizard
npm run config-cli

# Or with specific database type
node dist/tools/config-wizard.js --cli --database postgresql
```

## Features

### Database Configuration
- **Multi-database Support**: Configure multiple database connections
- **Connection Testing**: Test database connectivity during setup
- **Security Settings**: Configure security parameters and access controls
- **Performance Tuning**: Optimize connection pools and query settings

### Security Configuration
- **Authentication Methods**: Choose between different auth mechanisms
- **Access Control**: Configure user permissions and roles
- **Encryption**: Set up TLS/SSL and data encryption
- **Audit Logging**: Configure comprehensive audit trails

### Monitoring Setup
- **Metrics Collection**: Configure Prometheus metrics
- **Health Checks**: Set up health monitoring endpoints
- **Alerting**: Configure alert thresholds and notifications
- **Logging**: Set up structured logging with different levels

### Environment-specific Configs
- **Development**: Quick setup for development environments
- **Staging**: Production-like configuration for testing
- **Production**: Enterprise-ready production configuration
- **Custom**: Fully customizable configuration options

## Configuration Templates

### Basic Setup
```ini
[server]
host=localhost
port=3000
environment=development

[database.main]
type=postgresql
host=localhost
port=5432
database=myapp
username=user
readonly=false

[security]
enable_readonly_mode=false
rate_limit_max_requests=100

[logging]
level=debug
format=text
```

### Enterprise Setup
```ini
[server]
host=0.0.0.0
port=3000
environment=production
enable_tls=true
cert_path=/etc/ssl/certs/server.crt
key_path=/etc/ssl/private/server.key

[database.primary]
type=postgresql
host=db-primary.company.com
port=5432
database=production_db
username=mcp_user
readonly=true
pool_min=10
pool_max=50
ssl_mode=require

[database.replica1]
type=postgresql
host=db-replica1.company.com
port=5432
database=production_db
username=mcp_readonly
readonly=true
pool_min=5
pool_max=25
ssl_mode=require

[security]
enable_readonly_mode=true
max_query_complexity=100
rate_limit_window_ms=60000
rate_limit_max_requests=1000
enable_audit_logging=true
jwt_secret=${JWT_SECRET}

[logging]
level=info
format=json
audit_file=/var/log/mcp/audit.log

[monitoring]
enable_metrics=true
metrics_port=9090
health_check_path=/health

[ssh.bastion]
host=bastion.company.com
port=22
username=mcp_tunnel
private_key_path=/etc/ssh/mcp_key
local_port=15432
remote_host=internal-db.company.com
remote_port=5432
```

## Configuration Validation

The wizard includes built-in validation for:
- **Database Connectivity**: Tests connections before saving
- **Security Settings**: Validates security parameters
- **SSL/TLS Configuration**: Checks certificate validity
- **Port Availability**: Ensures ports are available
- **File Permissions**: Validates file and directory permissions

## Export Formats

Generated configurations can be exported in multiple formats:
- **INI Format**: Standard configuration file
- **JSON Format**: For programmatic usage
- **YAML Format**: For containerized deployments
- **Environment Variables**: For Docker/Kubernetes
- **Terraform Variables**: For infrastructure automation

## Advanced Features

### Custom Validation Rules
```javascript
// Add custom validation
wizard.addValidator('database.port', (value) => {
 return value > 1024 && value < 65535;
});
```

### Configuration Templates
```javascript
// Load predefined templates
wizard.loadTemplate('enterprise-postgres');
wizard.loadTemplate('development-mysql');
wizard.loadTemplate('high-availability');
```

### Environment-specific Overrides
```javascript
// Override for specific environments
wizard.setEnvironmentOverrides('production', {
 'security.enable_readonly_mode': true,
 'logging.level': 'warn',
 'monitoring.enable_metrics': true
});
```

## Integration

### Docker Integration
```dockerfile
FROM node:18-alpine
COPY config-wizard/ /app/config-wizard/
RUN cd /app/config-wizard && npm install
EXPOSE 8080
CMD ["node", "config-wizard.js"]
```

### CI/CD Integration
```yaml
# GitHub Actions example
- name: Generate Configuration
 run: |
 node tools/config-wizard.js --cli --template production \
 --database-host ${{ secrets.DB_HOST }} \
 --database-user ${{ secrets.DB_USER }} \
 --output config/production.ini
```

### Kubernetes ConfigMap Generation
```bash
# Generate ConfigMap from wizard output
kubectl create configmap argos-config \
 --from-file=config.ini=wizard-output.ini \
 --namespace argos
```

## Security Considerations

### Credential Management
- **No Stored Secrets**: Wizard never stores passwords or keys
- **Environment Variables**: Supports secure credential injection
- **External Secret Management**: Integration with HashiCorp Vault, AWS Secrets Manager
- **Encryption at Rest**: Generated configs can be encrypted

### Network Security
- **TLS Configuration**: Automated certificate setup
- **Network Policies**: Generates Kubernetes network policies
- **Firewall Rules**: Provides firewall configuration guidance
- **VPN/SSH Tunneling**: Configures secure database connections

## Troubleshooting

### Common Issues

**Connection Timeout**
```
Error: Connection to database timed out
Solution: Check network connectivity and firewall rules
```

**Certificate Validation Failed**
```
Error: SSL certificate validation failed
Solution: Verify certificate chain and hostname matching
```

**Permission Denied**
```
Error: Permission denied writing configuration file
Solution: Check file permissions and directory access
```

### Debug Mode
```bash
# Enable debug logging
node config-wizard.js --debug --verbose
```

### Configuration Testing
```bash
# Test generated configuration
npm run test-config -- --config generated-config.ini
```

## Contributing

To add new configuration templates or validation rules:

1. **Template Structure**:
 ```json
 {
 "name": "template-name",
 "description": "Template description",
 "sections": {
 "server": { "host": "0.0.0.0", "port": 3000 },
 "database": { "type": "postgresql" }
 },
 "validation": {
 "required": ["server.host", "database.type"],
 "rules": { "server.port": "number" }
 }
 }
 ```

2. **Custom Validators**:
 ```javascript
 function validateDatabaseType(value) {
 const supportedTypes = ['postgresql', 'mysql', 'sqlite', 'mssql'];
 return supportedTypes.includes(value);
 }
 ```

3. **Integration Tests**:
 ```javascript
 describe('ConfigWizard', () => {
 it('should generate valid PostgreSQL config', () => {
 const config = wizard.generate('postgresql-template');
 expect(config).toHaveProperty('database.type', 'postgresql');
 });
 });
 ```

For detailed API documentation, see [Configuration API Reference](../api/config-api.md).
