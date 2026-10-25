#!/bin/bash
# Start Argos for demo

set -e

echo "[START] Starting Argos..."

# Check if server is already running
if [ -f "server.pid" ]; then
    PID=$(cat server.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "[WARN] Server already running (PID: $PID)"
        echo "   Use ./stop-server.sh to stop it first"
        exit 1
    else
        rm server.pid
    fi
fi

# Check if config exists
if [ ! -f "config.ini" ]; then
    echo "[ERROR] Configuration file not found"
    echo "   Run ./setup-demo.sh first"
    exit 1
fi

# Check if database exists
if [ ! -f "demo.db" ]; then
    echo "[ERROR] Demo database not found"
    echo "   Run ./setup-demo.sh first"
    exit 1
fi

# Start server in background
echo "   Starting server with config: config.ini"
sql-server --config config.ini > server.log 2>&1 &
SERVER_PID=$!

# Save PID for cleanup
echo $SERVER_PID > server.pid

# Wait for server to start
echo "   Waiting for server to start..."
sleep 3

# Check if server is running
if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo "[OK] Argos started successfully"
    echo "   PID: $SERVER_PID"
    echo "   Config: config.ini"
    echo "   Database: demo.db"
    echo "   Logs: server.log"
    echo ""
    echo "   To stop: ./stop-server.sh"
    echo "   To test: ./test-queries.sh"
else
    echo "[ERROR] Failed to start server"
    echo "   Check server.log for errors:"
    tail -10 server.log
    rm -f server.pid
    exit 1
fi
