# Advanced Tutorial 2: SSH Tunnel Configuration

## Overview

This advanced tutorial covers secure database connections through SSH tunnels, enabling safe access to remote databases across untrusted networks. You'll learn to configure various SSH tunnel patterns, authentication methods, and troubleshooting techniques for production environments.

## Prerequisites

- Completed [Advanced Tutorial 1: Multi-Database Configuration](advanced-01-multi-database.md)
- SSH client installed and configured
- Access to SSH bastion hosts or jump servers
- Basic understanding of network security concepts
- SSH key management experience

## SSH Tunnel Architecture

```
+-------------------------------------------------------------------+
| SSH Tunnel Architecture                                           |
+-------------------------------------------------------------------+
|                                                                   |
|  +--------------+ Encrypted SSH  +------------------+             |
|  | Argos      |====Tunnel======| SSH Bastion      |             |
|  | Server       |                | Host             |             |
|  |(Local:1234)  |                |                  |             |
|  +--------------+                +------------------+             |
|                                        |                          |
|                                 Internal Network                  |
|                                        |                          |
|          +-----------------------------+------------+             |
|          |                             |            |             |
|          v                             v            v             |
|     +---------+                   +---------+  +---------+        |
|     |Database |                   |Database |  |Database |        |
|     |Server 1 |                   |Server 2 |  |Server 3 |        |
|     |:5432    |                   |:3306    |  |:1433    |        |
|     +---------+                   +---------+  +---------+        |
|                                                                   |
+-------------------------------------------------------------------+
```

## SSH Tunnel Patterns

### 1. Single Database SSH Tunnel

**Scenario**: Secure connection to a single remote PostgreSQL database

```ini
# config.ini - Basic SSH tunnel configuration
[database.production]
type=postgresql
host=localhost # Local tunnel endpoint
port=15432 # Local tunnel port (avoid conflicts)
database=production_db
username=app_user
password=secure_db_password
ssl=true
select_only=true

# SSH tunnel configuration
ssh_host=bastion.company.com # SSH server
ssh_port=22 # SSH port (default 22)
ssh_username=db_tunnel_user # SSH username
ssh_private_key=/secure/keys/prod.key # SSH private key path
ssh_local_port=15432 # Local port for tunnel
ssh_remote_host=db.internal.com # Internal database host
ssh_remote_port=5432 # Internal database port
```

### 2. Multi-Database SSH Tunnels

**Scenario**: Multiple databases behind the same bastion host

```ini
# PostgreSQL through SSH tunnel
[database.users]
type=postgresql
host=localhost
port=15432
database=users
username=readonly_user
password=users_db_password
ssl=true
select_only=true

# SSH tunnel for PostgreSQL
ssh_host=bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/keys/production.key
ssh_local_port=15432
ssh_remote_host=postgres.internal.company.com
ssh_remote_port=5432

# MySQL through same bastion
[database.orders]
type=mysql
host=localhost
port=13306
database=orders
username=readonly_user
password=orders_db_password
ssl=true
select_only=true

# SSH tunnel for MySQL
ssh_host=bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/keys/production.key
ssh_local_port=13306
ssh_remote_host=mysql.internal.company.com
ssh_remote_port=3306

# SQL Server through tunnel
[database.analytics]
type=mssql
host=localhost
port=11433
database=analytics
username=analytics_user
password=analytics_password
ssl=true
select_only=true

# SSH tunnel for SQL Server
ssh_host=bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/keys/production.key
ssh_local_port=11433
ssh_remote_host=sqlserver.internal.company.com
ssh_remote_port=1433
```

### 3. Multi-Hop SSH Tunnels

**Scenario**: Database behind multiple SSH hops

```ini
# Database behind multi-hop SSH tunnel
[database.secure_production]
type=postgresql
host=localhost
port=25432
database=secure_production
username=secure_user
password=highly_secure_password
ssl=true
select_only=true

# First hop: External bastion
ssh_host=external-bastion.company.com
ssh_port=2222
ssh_username=external_tunnel
ssh_private_key=/keys/external.key

# Second hop configuration (handled by SSH client config)
# This requires ~/.ssh/config setup for multi-hop
```

**SSH Client Configuration for Multi-Hop**:
```bash
# ~/.ssh/config
Host external-bastion
 HostName external-bastion.company.com
 Port 2222
 User external_tunnel
 IdentityFile /keys/external.key
 ControlMaster auto
 ControlPath /tmp/ssh_%r@%h:%p
 ControlPersist 600

Host internal-bastion
 HostName internal-bastion.company.local
 User internal_tunnel
 IdentityFile /keys/internal.key
 ProxyJump external-bastion

Host secure-db
 HostName secure-db.company.local
 User db_tunnel
 IdentityFile /keys/database.key
 ProxyJump internal-bastion
 LocalForward 25432 secure-db.company.local:5432
```

## Authentication Methods

### 1. Private Key Authentication (Recommended)

**Generate and configure SSH keys**:
```bash
#!/bin/bash
# ssh-key-setup.sh

# Generate SSH key pair
ssh-keygen -t ed25519 -b 521 -f /secure/keys/argos-tunnel -C "argos@$(hostname)"

# Set proper permissions
chmod 600 /secure/keys/argos-tunnel
chmod 644 /secure/keys/argos-tunnel.pub

# Copy public key to bastion host
ssh-copy-id -i /secure/keys/argos-tunnel.pub tunnel_user@bastion.company.com

echo "SSH key setup complete. Private key: /secure/keys/argos-tunnel"
```

**Configuration with private key**:
```ini
[database.production]
type=postgresql
host=localhost
port=15432
# ... database configuration

# SSH tunnel with private key
ssh_host=bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/secure/keys/argos-tunnel
ssh_private_key_passphrase=optional_key_passphrase # If key is encrypted
```

### 2. SSH Agent Authentication

**Configuration for SSH agent**:
```ini
[database.production]
type=postgresql
# ... database configuration

# SSH tunnel using SSH agent
ssh_host=bastion.company.com
ssh_username=tunnel_service
ssh_use_agent=true # Use SSH agent instead of private key file
```

**SSH Agent setup**:
```bash
#!/bin/bash
# setup-ssh-agent.sh

# Start SSH agent
eval $(ssh-agent)

# Add private key to agent
ssh-add /secure/keys/argos-tunnel

# Verify key is loaded
ssh-add -l

echo "SSH Agent configured with tunnel key"
```

### 3. Certificate-Based Authentication

**Configuration with certificates**:
```ini
[database.secure_prod]
type=postgresql
# ... database configuration

# SSH tunnel with certificate
ssh_host=bastion.company.com
ssh_username=cert_user
ssh_certificate=/secure/certs/argos-cert.pub
ssh_private_key=/secure/keys/argos-key
```

## Advanced Tunnel Configurations

#### 1. Dynamic Port Allocation

**Automatic port assignment**:
```ini
# Let system choose available local port automatically
[database.dynamic_tunnel]
type=postgresql
host=db.internal.com       # Database host relative to bastion bastion
port=5432                  # Database port on remote network
database=production
username=app_user
password=secure_password

ssh_host=bastion.company.com
ssh_username=tunnel_user
ssh_private_key=/keys/tunnel.key
local_port=0               # Auto-assign available local port (or omit)
```

### 2. Static Port Configuration

**Bind tunnel to a specific local port**:
```ini
[database.static_tunnel]
type=postgresql
host=db.internal.com
port=5432
database=production
username=app_user
password=secure_password

ssh_host=bastion.company.com
ssh_username=tunnel_user
ssh_private_key=/keys/tunnel.key
local_port=15432           # Manually bind to local port 15432
ssh_local_host=127.0.0.1   # Local bind address (default: 127.0.0.1)
```

## Security Hardening

### 1. SSH Key Security

**Secure key generation and storage**:
```bash
#!/bin/bash
# secure-key-setup.sh

# Create secure directory
sudo mkdir -p /etc/argos/keys
sudo chmod 700 /etc/argos/keys

# Generate key with strong parameters
ssh-keygen -t ed25519 -a 100 -f /etc/argos/keys/tunnel_key -C "argos-$(date +%Y%m%d)"

# Set restrictive permissions
sudo chmod 600 /etc/argos/keys/tunnel_key
sudo chmod 644 /etc/argos/keys/tunnel_key.pub
sudo chown argos:argos /etc/argos/keys/tunnel_key*

# Create key configuration
cat > /etc/argos/ssh-config << EOF
Host tunnel-bastion
 HostName bastion.company.com
 User tunnel_service
 IdentityFile /etc/argos/keys/tunnel_key
 IdentitiesOnly yes
 StrictHostKeyChecking yes
 UserKnownHostsFile /etc/argos/known_hosts
 ServerAliveInterval 60
 ServerAliveCountMax 3
EOF

echo "Secure SSH key setup complete"
```

### 2. Bastion Host Security

**SSH server hardening on bastion hosts**:
```bash
# /etc/ssh/sshd_config hardening
Protocol 2
Port 2222 # Non-standard port
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
MaxAuthTries 3
MaxStartups 10:30:60
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers tunnel_service argos-tunnel
DenyUsers root admin guest
```

### 3. Network Security

**Firewall rules for SSH tunnels**:
```bash
#!/bin/bash
# firewall-setup.sh

# Allow SSH from specific IPs only
sudo ufw allow from 192.168.1.100 to any port 2222 proto tcp comment "Argos SSH"

# Block all other SSH access
sudo ufw deny 22
sudo ufw deny 2222

# Allow only necessary database ports locally
sudo ufw allow from 127.0.0.1 to any port 15432 proto tcp comment "Local PostgreSQL tunnel"
sudo ufw allow from 127.0.0.1 to any port 13306 proto tcp comment "Local MySQL tunnel"

# Enable logging
sudo ufw logging on

echo "Firewall rules configured for SSH tunnels"
```

## Monitoring and Troubleshooting

### 1. SSH Tunnel Health Monitoring

**Health check script**:
```bash
#!/bin/bash
# tunnel-health-check.sh

BASTION_HOST="bastion.company.com"
SSH_USER="tunnel_service"
SSH_KEY="/secure/keys/tunnel.key"
LOCAL_PORT=15432
REMOTE_HOST="db.internal.com"
REMOTE_PORT=5432

# Function to check SSH connectivity
check_ssh_connection() {
 ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o BatchMode=yes "$SSH_USER@$BASTION_HOST" "echo SSH connection successful"
 return $?
}

# Function to check tunnel connectivity
check_tunnel() {
 # Test if local port is listening
 if ! lsof -i ":$LOCAL_PORT" > /dev/null 2>&1; then
 echo "ERROR: Tunnel port $LOCAL_PORT not listening"
 return 1
 fi
 
 # Test database connectivity through tunnel
 nc -z localhost "$LOCAL_PORT"
 return $?
}

# Function to restart tunnel
restart_tunnel() {
 echo "Restarting SSH tunnel..."
 pkill -f "ssh.*$LOCAL_PORT:$REMOTE_HOST:$REMOTE_PORT"
 sleep 2
 
 ssh -i "$SSH_KEY" -fN -L "$LOCAL_PORT:$REMOTE_HOST:$REMOTE_PORT" "$SSH_USER@$BASTION_HOST"
 return $?
}

# Main monitoring logic
echo "Checking SSH tunnel health..."

if ! check_ssh_connection; then
 echo "ERROR: SSH connection to bastion failed"
 exit 1
fi

if ! check_tunnel; then
 echo "WARNING: Tunnel connectivity issue detected"
 if restart_tunnel; then
 echo "Tunnel restarted successfully"
 else
 echo "ERROR: Failed to restart tunnel"
 exit 1
 fi
else
 echo "SSH tunnel healthy"
fi
```

### 2. Connection Diagnostics

**Diagnostic queries for tunnel connections**:
```sql
-- Test basic connectivity through tunnel
SELECT 'Tunnel connection successful' as status, 
 current_timestamp as test_time,
 version() as database_version;

-- Check connection source (should show localhost)
SELECT 
 client_addr as connection_source,
 state,
 query_start,
 application_name
FROM pg_stat_activity 
WHERE pid = pg_backend_pid();

-- Monitor active connections through tunnel
SELECT 
 count(*) as active_connections,
 client_addr,
 application_name
FROM pg_stat_activity 
WHERE client_addr = '127.0.0.1' -- Tunnel connections
GROUP BY client_addr, application_name;
```

### 3. Performance Optimization

**Tunnel performance tuning**:
```ini
# Optimized SSH tunnel settings
[database.performance_tuned]
type=postgresql
host=localhost
port=15432
# ... database settings

# Performance SSH settings
ssh_host=bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/keys/tunnel.key

# Compression settings
ssh_compression=true
ssh_compression_level=6 # Balance between CPU and bandwidth

# Connection reuse
ssh_multiplex=true
ssh_control_persist=600 # Keep master connection for 10 minutes

# Buffer sizes
ssh_send_env=LC_TUNNEL_BUFFER_SIZE=131072
ssh_tcp_no_delay=true

# Keep-alive settings
ssh_server_alive_interval=30
ssh_server_alive_count_max=6
```

## Automation and Scripting

### 1. Automated Tunnel Management

**Tunnel management script**:
```bash
#!/bin/bash
# tunnel-manager.sh

CONFIG_FILE="/etc/argos/tunnel-config.conf"
PID_FILE="/var/run/argos-tunnels.pid"
LOG_FILE="/var/log/argos/tunnel.log"

# Load tunnel configurations
source "$CONFIG_FILE"

# Function to start all tunnels
start_tunnels() {
 echo "Starting SSH tunnels..." | tee -a "$LOG_FILE"
 
 for tunnel in "${TUNNELS[@]}"; do
 IFS=':' read -r name local_port remote_host remote_port ssh_config <<< "$tunnel"
 
 echo "Starting tunnel: $name ($local_port -> $remote_host:$remote_port)" | tee -a "$LOG_FILE"
 
 ssh -f -N -L "$local_port:$remote_host:$remote_port" "$ssh_config" \
 -o ExitOnForwardFailure=yes \
 -o ServerAliveInterval=60 \
 -o ServerAliveCountMax=3
 
 if [ $? -eq 0 ]; then
 echo "Tunnel $name started successfully" | tee -a "$LOG_FILE"
 else
 echo "ERROR: Failed to start tunnel $name" | tee -a "$LOG_FILE"
 fi
 done
}

# Function to stop all tunnels
stop_tunnels() {
 echo "Stopping SSH tunnels..." | tee -a "$LOG_FILE"
 
 for tunnel in "${TUNNELS[@]}"; do
 IFS=':' read -r name local_port remote_host remote_port ssh_config <<< "$tunnel"
 
 # Kill tunnel processes
 pkill -f "ssh.*$local_port:$remote_host:$remote_port"
 echo "Stopped tunnel: $name" | tee -a "$LOG_FILE"
 done
}

# Function to check tunnel status
check_tunnels() {
 echo "Checking tunnel status..." | tee -a "$LOG_FILE"
 
 for tunnel in "${TUNNELS[@]}"; do
 IFS=':' read -r name local_port remote_host remote_port ssh_config <<< "$tunnel"
 
 if lsof -i ":$local_port" > /dev/null 2>&1; then
 echo "Tunnel $name (port $local_port): ACTIVE" | tee -a "$LOG_FILE"
 else
 echo "Tunnel $name (port $local_port): INACTIVE" | tee -a "$LOG_FILE"
 fi
 done
}

# Main script logic
case "$1" in
 start)
 start_tunnels
 ;;
 stop)
 stop_tunnels
 ;;
 restart)
 stop_tunnels
 sleep 3
 start_tunnels
 ;;
 status)
 check_tunnels
 ;;
 *)
 echo "Usage: $0 {start|stop|restart|status}"
 exit 1
 ;;
esac
```

### 2. Systemd Service Integration

**Systemd service for tunnel management**:
```ini
# /etc/systemd/system/argos-tunnels.service
[Unit]
Description=Argos SSH Tunnels
After=network.target
Wants=network.target

[Service]
Type=forking
ExecStart=/usr/local/bin/tunnel-manager.sh start
ExecStop=/usr/local/bin/tunnel-manager.sh stop
ExecReload=/usr/local/bin/tunnel-manager.sh restart
PIDFile=/var/run/argos-tunnels.pid
Restart=always
RestartSec=30
User=argos
Group=argos

# Security settings
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/argos /var/run

[Install]
WantedBy=multi-user.target
```

## Docker and Container Support

### 1. SSH Tunnels in Docker

**Dockerfile with SSH tunnel support**:
```dockerfile
FROM node:24-alpine

# Install SSH client
RUN apk add --no-cache openssh-client

# Create SSH directory
RUN mkdir -p /home/node/.ssh && \
 chmod 700 /home/node/.ssh && \
 chown node:node /home/node/.ssh

# Copy SSH configuration and keys
COPY --chown=node:node ssh-config/config /home/node/.ssh/config
COPY --chown=node:node ssh-config/tunnel_key /home/node/.ssh/tunnel_key
RUN chmod 600 /home/node/.ssh/tunnel_key

# Copy application
COPY --chown=node:node . /app
WORKDIR /app

# Install dependencies
RUN npm ci --only=production

# Switch to non-root user
USER node

# Start script that manages SSH tunnels
COPY start-with-tunnels.sh /app/
CMD ["./start-with-tunnels.sh"]
```

**Container startup script**:
```bash
#!/bin/bash
# start-with-tunnels.sh

set -e

echo "Starting SSH tunnels..."

# Start SSH tunnels in background
ssh -f -N -L 15432:db.internal.com:5432 tunnel_service@bastion.company.com \
 -o StrictHostKeyChecking=no \
 -o UserKnownHostsFile=/dev/null \
 -o ServerAliveInterval=60 \
 -o ServerAliveCountMax=3

# Wait for tunnels to establish
sleep 5

# Verify tunnel connectivity
nc -z localhost 15432 || {
 echo "ERROR: SSH tunnel failed to establish"
 exit 1
}

echo "SSH tunnels established successfully"

# Start the main application
exec node dist/cli.js serve
```

### 2. Docker Compose with SSH Tunnels

**docker-compose.yml with tunnel sidecar**:
```yaml
version: '3.8'

services:
 ssh-tunnel:
 image: alpine/socat
 command: >
 sh -c "
 apk add --no-cache openssh-client &&
 ssh -f -N -L 0.0.0.0:5432:db.internal.com:5432 tunnel_service@bastion.company.com \
 -i /keys/tunnel_key \
 -o StrictHostKeyChecking=no &&
 socat TCP-LISTEN:5432,fork,reuseaddr TCP:localhost:5432
 "
 volumes:
 - ./ssh-keys:/keys:ro
 ports:
 - "15432:5432"
 networks:
 - argos-network

 argos:
 build: .
 depends_on:
 - ssh-tunnel
 environment:
 - DATABASE_HOST=ssh-tunnel
 - DATABASE_PORT=5432
 networks:
 - argos-network

networks:
 argos-network:
 driver: bridge
```

## Troubleshooting Common Issues

### 1. Connection Failures

**Issue**: SSH tunnel connection fails
```bash
# Debug SSH connection
ssh -vvv -i /keys/tunnel.key tunnel_user@bastion.company.com

# Common solutions:
# 1. Check SSH key permissions (must be 600)
chmod 600 /keys/tunnel.key

# 2. Verify SSH key is correct
ssh-keygen -l -f /keys/tunnel.key

# 3. Test SSH connectivity without tunnel
ssh -i /keys/tunnel.key tunnel_user@bastion.company.com "echo Connection successful"
```

### 2. Port Conflicts

**Issue**: Local port already in use
```bash
# Find process using port
lsof -i :15432
netstat -tlnp | grep 15432

# Kill conflicting process
kill $(lsof -t -i:15432)

# Use dynamic port allocation
# Set ssh_local_port=0 in config.ini
```

### 3. Tunnel Drops

**Issue**: SSH tunnel connections drop frequently
```ini
# Add keep-alive settings to config
ssh_server_alive_interval=30
ssh_server_alive_count_max=6
ssh_tcp_keep_alive=true

# Enable connection multiplexing
ssh_multiplex=true
ssh_control_persist=600
```

### 4. Performance Issues

**Issue**: Slow queries through tunnel
```bash
# Test network latency
ping bastion.company.com

# Test tunnel throughput
iperf3 -c bastion.company.com -p 5001

# Enable compression for slow networks
ssh_compression=true
ssh_compression_level=6
```

## Best Practices Summary

### SSH Security Best Practices

- [ ] Use strong SSH key algorithms (ed25519 or RSA 4096+)
- [ ] Implement key rotation policies
- [ ] Use dedicated tunnel users with restricted access
- [ ] Enable SSH key passphrases for sensitive environments
- [ ] Implement SSH certificate-based authentication where possible

### Network Configuration Best Practices

- [ ] Use non-standard SSH ports on bastion hosts
- [ ] Implement IP allowlisting for SSH access
- [ ] Configure proper firewall rules
- [ ] Use dedicated tunnel ports to avoid conflicts
- [ ] Monitor tunnel connections and performance

### Operational Best Practices

- [ ] Implement automated tunnel health checking
- [ ] Use connection pooling for tunnel connections
- [ ] Log all tunnel activities
- [ ] Have fallback tunnel paths configured
- [ ] Regular security audits of SSH access

### Container and Deployment Best Practices

- [ ] Use SSH agent forwarding carefully in containers
- [ ] Implement proper secret management for SSH keys
- [ ] Use tunnel sidecars for better separation of concerns
- [ ] Monitor tunnel status in container orchestration
- [ ] Implement graceful tunnel shutdown procedures

## Next Steps

After mastering SSH tunnel configuration:

1. **Advanced Tutorial 3**: [Security Configuration](advanced-03-security.md)
2. **Advanced Tutorial 4**: [Performance Optimization](advanced-04-performance.md)
3. **Database-Specific Guides**: [SSH Tunneling](../databases/ssh-tunneling.md)

## Additional Resources

- [Security Guide](../guides/security-guide.md) - Comprehensive security practices
- [Configuration Guide](../guides/configuration-guide.md) - Complete configuration reference
- [Troubleshooting Guide](../guides/troubleshooting-guide.md) - Common issues and solutions
- [Operations Documentation](../operations/) - Production deployment guides

---

*This tutorial is part of the Argos Advanced Configuration Series. For questions or feedback, please refer to our [community discussions](https://github.com/AraneaDev/argos/discussions).*