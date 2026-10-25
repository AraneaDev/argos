# Enhanced SSH Tunnel Port Management

## Implementation Status

- **Fully Implemented**: Smart port detection, database-specific port suggestions, conflict resolution, enhanced tunnel creation
- **Available Methods**: `createEnhancedTunnel()`, `getPortRecommendations()`, `checkPortAvailability()`, `getTunnelStats()`
- **Future Enhancements**: Port pool management, dynamic port rebalancing, service discovery integration

## Overview

The Enhanced SSH Tunnel Management system provides intelligent automatic port assignment for SSH tunnels, eliminating port conflicts and improving the user experience when connecting to databases through SSH tunnels.

## Key Features

### **Smart Port Detection**
- Automatically detects available ports on the local system
- Checks for conflicts with running services
- Avoids commonly used ports (80, 443, 3000, 8080, etc.)

### **Database-Specific Port Suggestions**
- MySQL tunnels prefer ports like 3307, 3308, 3316, 3406, 4306
- PostgreSQL tunnels prefer ports like 5433, 5442, 5532, 6432
- SQL Server tunnels prefer ports like 1434, 1443, 1533, 2433

### **Flexible Configuration Options**
- **Auto-assignment**: `local_port=0` or omit the setting
- **Preferred port**: `local_port=3307` (system finds alternative if unavailable)
- **Strict mode**: Force specific port (fails if unavailable)

### **Conflict Resolution**
- Automatically finds alternatives when preferred ports are unavailable
- Provides meaningful error messages and suggestions
- Handles concurrent tunnel creation without conflicts

## Configuration Examples

### Basic Auto-Assignment (Recommended)
```ini
[database.production]
type=mysql
host=remote-server.com
port=3306
# ... other database settings ...

# SSH tunnel configuration
ssh_host=bastion.company.com
ssh_username=deploy_user
ssh_private_key=/path/to/key

# Let system choose port automatically
# local_port=0 # Optional - this is the default behavior
```

### Preferred Port with Fallback
```ini
[database.staging]
type=postgresql
host=staging-db.com
port=5432
# ... other database settings ...

ssh_host=staging-bastion.com
ssh_username=deploy_user
ssh_password=ssh_password

# Request port 5433 first, but allow alternatives
local_port=5433
```

### Multiple Databases with Smart Port Assignment
```ini
[database.mysql_prod]
type=mysql
host=mysql.internal
port=3306
ssh_host=bastion.com
ssh_username=deploy
ssh_private_key=/keys/mysql_key
# Will get MySQL-specific port like 3307

[database.postgres_prod] 
type=postgresql
host=postgres.internal
port=5432
ssh_host=bastion.com
ssh_username=deploy
ssh_private_key=/keys/postgres_key
# Will get PostgreSQL-specific port like 5433

[database.mssql_prod]
type=mssql
host=mssql.internal
port=1433
ssh_host=bastion.com
ssh_username=deploy
ssh_private_key=/keys/mssql_key
# Will get SQL Server-specific port like 1434
```

## How It Works

### 1. Port Assignment Logic

When creating an SSH tunnel, the system follows this intelligent assignment process:

```
1. User specifies preferred port? 
 |- YES: Check if available
 | |- Available? -> Use preferred port 
 | \- Unavailable? -> Log warning, continue to step 2
 \- NO: Continue to step 2

2. Database type detected?
 |- YES: Try database-specific alternatives (3307, 3308, etc.)
 | \- Found available? -> Use database-specific port 
 \- NO: Continue to step 3
 
3. Search safe port range (30000-40000)
 \- Find first available port -> Use safe range port 

4. No ports available?
 \- Throw detailed error with attempted ports
```

### 2. Database-Specific Alternatives

The system recognizes database types and suggests appropriate alternatives:

| Database | Base Port | Suggested Alternatives |
|----------|-----------|----------------------|
| MySQL | 3306 | 3307, 3308, 3309, 3316, 3406, 4306 |
| PostgreSQL | 5432 | 5433, 5434, 5435, 5442, 5532, 6432 |
| SQL Server | 1433 | 1434, 1435, 1436, 1443, 1533, 2433 |

### 3. Port Conflict Detection

```typescript
// The system checks for conflicts by attempting to bind to ports
const server = net.createServer();
server.listen(port, '127.0.0.1', () => {
 // Port is available
 server.close();
});

server.on('error', (error) => {
 // Port is unavailable - provides specific error reason
 if (error.code === 'EADDRINUSE') {
 // Port already in use
 } else if (error.code === 'EACCES') {
 // Permission denied (privileged port)
 }
});
```

## API Reference

### PortManager Class

```typescript
class PortManager {
 // Check if a port is available
 async isPortAvailable(port: number): Promise<PortCheckResult>
 
 // Find an available port with options
 async findAvailablePort(options: PortAssignmentOptions): Promise<PortAssignmentResult>
 
 // Get database-specific port recommendations
 getPortRecommendations(databaseType: string): number[]
 
 // Suggest optimal tunnel port for database type
 async suggestTunnelPort(databaseType: string, preferredPort?: number): Promise<PortAssignmentResult>
 
 // Check multiple ports simultaneously
 async checkMultiplePorts(ports: number[]): Promise<PortCheckResult[]>
 
 // Get human-readable port status
 async getPortStatus(port: number): Promise<string>
}
```

### EnhancedSSHTunnelManager Class

```typescript
class EnhancedSSHTunnelManager {
 // Create tunnel with intelligent port assignment
 async createEnhancedTunnel(dbName: string, options: SSHTunnelCreateOptions): Promise<TunnelCreationResult>
 
 // Get port recommendations for database type
 async getPortRecommendations(databaseType: string): Promise<{
 recommended: number[];
 available: number[];
 status: Array<{port: number; available: boolean; reason?: string}>;
 }>
 
 // Check port availability with suggestions
 async checkPortAvailability(port: number): Promise<{
 available: boolean;
 reason?: string;
 suggestion?: number;
 }>
 
 // Get enhanced statistics including port info
 getTunnelStats(): {
 total: number;
 active: number;
 connecting: number;
 errors: number;
 portInfo: {
 reserved: number[];
 preferredUsed: number;
 autoAssigned: number;
 };
 }
}
```

## Migration Guide

### From Basic SSH Tunneling

**Before (Manual Port Management):**
```ini
[database.prod]
type=mysql
host=db.internal
port=3306
ssh_host=bastion.com
ssh_username=deploy
ssh_private_key=/path/to/key
local_port=3307 # Manual assignment, conflicts possible
```

**After (Enhanced Port Management):**
```ini
[database.prod]
type=mysql
host=db.internal 
port=3306
ssh_host=bastion.com
ssh_username=deploy
ssh_private_key=/path/to/key
# local_port automatically assigned - no conflicts!
```

### Handling Existing Configurations

Existing configurations continue to work:
- If `local_port` is specified, system tries to use it but falls back gracefully
- If `local_port=0` or omitted, system uses intelligent assignment
- No breaking changes to existing config files

## Advanced Configuration

### Global SSH Tunnel Settings

```ini
[ssh_tunnel]
# Port range for automatic assignment (default: 30000-40000)
port_range_min=30000
port_range_max=40000

# Maximum attempts to find available port (default: 50)
max_port_attempts=50

# Whether to prefer database-specific alternatives (default: true)
prefer_db_alternatives=true

# Ports to exclude from automatic assignment
exclude_ports=3000,8080,8443,9200

# Enable detailed port management logging (default: false)
debug_port_assignment=false
```

## Troubleshooting

### Common Issues and Solutions

#### Issue: "Failed to find available port"
**Cause:** System couldn't find any available ports in the specified range.

**Solutions:**
1. Increase port range: `port_range_max=50000`
2. Increase max attempts: `max_port_attempts=100`
3. Check for services occupying ports: `netstat -tulpn`
4. Exclude problematic ports: `exclude_ports=3000,3001,3002`

#### Issue: "Preferred port 3307 is not available"
**Cause:** Another service is using the requested port.

**Solutions:**
1. Let system auto-assign: Remove or set `local_port=0`
2. Choose different preferred port: `local_port=3308`
3. Find what's using the port: `lsof -i :3307`

#### Issue: Tunnel creation is slow
**Cause:** System is checking many occupied ports.

**Solutions:**
1. Use database-specific hints: Ensure correct `type` is set
2. Reduce search range: Set narrower `port_range_min`/`port_range_max`
3. Exclude known busy ports: Use `exclude_ports`

### Debugging Port Assignment

Enable detailed logging:
```ini
[ssh_tunnel]
debug_port_assignment=true
```

This will log:
- Port availability checks
- Assignment attempts and results
- Conflict detection details
- Performance metrics

### Port Status Commands

Check specific port availability:
```bash
# Using the Argos tools (if available)
argos serve --check-port 3307

# Using system tools
netstat -tulpn | grep :3307
lsof -i :3307
```

## Performance Considerations

### Optimization Tips

1. **Use database-specific types**: Ensure `type=mysql`, `type=postgresql`, etc. are set correctly for optimal port suggestions.

2. **Configure appropriate ranges**: Set `port_range_min` and `port_range_max` based on your environment:
 - **Development**: 30000-35000 (smaller range, faster assignment)
 - **Production**: 30000-50000 (larger range, more options)

3. **Exclude busy ports**: Add commonly used ports to `exclude_ports` to avoid checking them repeatedly.

4. **Monitor port usage**: Use `getTunnelStats()` to monitor port assignment patterns and adjust configuration accordingly.

### Performance Metrics

The system tracks:
- Port check duration (typically <50ms per port)
- Assignment success rate
- Fallback frequency (preferred vs auto-assigned ports)
- Memory usage for port reservations

## Security Considerations

### Port Range Security

- **Safe Ranges**: Use ports 30000+ to avoid conflicts with system services
- **Privileged Ports**: System automatically avoids ports <1024 that require root access
- **Common Services**: Automatically excludes well-known ports (22, 80, 443, etc.)

### Network Security

- All tunnels bind to `127.0.0.1` (localhost only)
- No external network access to tunnel ports
- Port assignments logged for audit trails

### Access Control

- Port reservations prevent conflicts between multiple tunnel instances
- Cleanup on tunnel closure prevents port leaks
- Graceful handling of permission denied errors

## Best Practices

### 1. Configuration Management
```ini
# Good: Let system manage ports
[database.prod]
type=mysql
ssh_host=bastion.com
# local_port automatically assigned

# Avoid: Hard-coded ports in shared configs
[database.prod]
type=mysql
ssh_host=bastion.com
local_port=3307 # May conflict on different systems
```

### 2. Database Type Specification
```ini
# Good: Specify correct database type
[database.mysql_server]
type=mysql # Enables MySQL-specific port suggestions

# Avoid: Generic or missing type
[database.mysql_server]
type=database # No intelligent port suggestions
```

### 3. Environment-Specific Configuration
```ini
# Development environment
[ssh_tunnel]
port_range_min=30000
port_range_max=32000
debug_port_assignment=true

# Production environment 
[ssh_tunnel]
port_range_min=35000
port_range_max=45000
debug_port_assignment=false
```

### 4. Monitoring and Alerting
```typescript
// Monitor tunnel statistics
const stats = tunnelManager.getTunnelStats();
if (stats.errors > 0) {
 console.warn('SSH tunnel errors detected:', stats.errors);
}

if (stats.portInfo.autoAssigned > stats.portInfo.preferredUsed) {
 console.info('Most tunnels using auto-assigned ports - consider reviewing port preferences');
}
```

## Future Enhancements

### Planned Features

1. **Port Pool Management**: Pre-allocate port ranges for specific database types
2. **Dynamic Port Rebalancing**: Automatically redistribute ports under pressure
3. **Integration with Service Discovery**: Coordinate with container orchestration systems
4. **Port Usage Analytics**: Detailed reporting on port usage patterns
5. **Custom Port Strategies**: Pluggable port assignment algorithms

### API Extensions

```typescript
// Future API additions
interface PortManager {
 // Port pool management
 createPortPool(dbType: string, size: number): Promise<PortPool>
 
 // Advanced conflict resolution
 resolvePortConflicts(preferences: PortPreference[]): Promise<PortResolution[]>
 
 // Performance monitoring
 getPortAssignmentMetrics(): PortMetrics
}
```

This enhanced SSH tunnel port management system significantly improves the reliability and user experience of database connections through SSH tunnels, eliminating the common frustration of port conflicts while providing intelligent, database-aware port assignment.
