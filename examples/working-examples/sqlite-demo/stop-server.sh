#!/bin/bash
# Stop Argos

set -e

echo "[STOP] Stopping Argos..."

# Check if PID file exists
if [ ! -f "server.pid" ]; then
    echo "[WARN] No server PID file found"
    echo "   Server may not be running"
    exit 0
fi

SERVER_PID=$(cat server.pid)

# Check if process is running
if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo "   Stopping server (PID: $SERVER_PID)"
    
    # Try graceful shutdown first
    kill -TERM $SERVER_PID 2>/dev/null || true
    
    # Wait up to 10 seconds for graceful shutdown
    for i in {1..10}; do
        if ! ps -p $SERVER_PID > /dev/null 2>&1; then
            echo "[OK] Server stopped gracefully"
            rm server.pid
            exit 0
        fi
        sleep 1
        echo "   Waiting for graceful shutdown... ($i/10)"
    done
    
    # Force kill if graceful shutdown failed
    echo "   Forcing shutdown..."
    kill -KILL $SERVER_PID 2>/dev/null || true
    sleep 1
    
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        echo "[ERROR] Failed to stop server"
        exit 1
    else
        echo "[OK] Server stopped (forced)"
        rm server.pid
    fi
else
    echo "[WARN] Server process not found (PID: $SERVER_PID)"
    echo "   Cleaning up PID file"
    rm server.pid
fi

# Clean up log file if it's large
if [ -f "server.log" ]; then
    LOG_SIZE=$(wc -c < server.log)
    if [ $LOG_SIZE -gt 1048576 ]; then  # 1MB
        echo "   Archiving large log file..."
        mv server.log "server-$(date +%Y%m%d-%H%M%S).log"
        echo "   Log archived as server-$(date +%Y%m%d-%H%M%S).log"
    fi
fi

echo "[CLEAN] Cleanup complete"
