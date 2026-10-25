#!/usr/bin/env python3
"""
Argos Python Client - Complete Integration Example
Demonstrates comprehensive interaction with Argos via WebSocket
"""

import asyncio
import json
import logging
import time
from typing import Dict, List, Any, Optional
import websockets
from dataclasses import dataclass
from contextlib import asynccontextmanager

@dataclass
class QueryResult:
    """Structured query result"""
    success: bool
    rows: List[Dict[str, Any]] = None
    columns: List[str] = None
    row_count: int = 0
    execution_time_ms: int = 0
    error: str = None

class SQLMCPClient:
    """
    Asynchronous Python client for Argos
    Provides high-level interface for database operations
    """
    
    def __init__(self, url: str = "ws://localhost:3001", timeout: int = 30):
        self.url = url
        self.timeout = timeout
        self.websocket = None
        self.request_id = 0
        self.logger = logging.getLogger(__name__)
        
    async def connect(self) -> bool:
        """Connect to Argos with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.websocket = await asyncio.wait_for(
                    websockets.connect(self.url), 
                    timeout=self.timeout
                )
                self.logger.info(f"Connected to Argos at {self.url}")
                return True
            except Exception as e:
                self.logger.warning(f"Connection attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        self.logger.error(f"Failed to connect after {max_retries} attempts")
        return False
        
    async def disconnect(self):
        """Gracefully disconnect from server"""
        if self.websocket:
            await self.websocket.close()
            self.logger.info("Disconnected from Argos")
    
    async def _send_request(self, method: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Send JSON-RPC request with timeout and error handling"""
        if not self.websocket:
            raise ConnectionError("Not connected to Argos")
            
        self.request_id += 1
        
        request = {
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
            "params": params or {}
        }
        
        try:
            await asyncio.wait_for(
                self.websocket.send(json.dumps(request)),
                timeout=self.timeout
            )
            
            response_text = await asyncio.wait_for(
                self.websocket.recv(),
                timeout=self.timeout
            )
            
            response = json.loads(response_text)
            
            if "error" in response:
                raise RuntimeError(f"Server error: {response['error']}")
                
            return response.get("result", {})
            
        except asyncio.TimeoutError:
            raise TimeoutError(f"Request timed out after {self.timeout}s")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON response: {e}")
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available MCP tools"""
        result = await self._send_request("tools/list")
        return result.get("tools", [])
    
    async def query(self, database: str, query: str, params: List[str] = None) -> QueryResult:
        """
        Execute SQL query with comprehensive result handling
        
        Args:
            database: Database name
            query: SQL query string
            params: Optional query parameters
            
        Returns:
            QueryResult object with structured data
        """
        start_time = time.time()
        
        try:
            result = await self._send_request("tools/call", {
                "name": "sql_query",
                "arguments": {
                    "database": database,
                    "query": query,
                    "params": params or []
                }
            })
            
            execution_time = int((time.time() - start_time) * 1000)
            
            if result.get("success"):
                return QueryResult(
                    success=True,
                    rows=result.get("rows", []),
                    columns=result.get("columns", []),
                    row_count=len(result.get("rows", [])),
                    execution_time_ms=execution_time
                )
            else:
                return QueryResult(
                    success=False,
                    error=result.get("error", "Unknown error"),
                    execution_time_ms=execution_time
                )
                
        except Exception as e:
            return QueryResult(
                success=False,
                error=str(e),
                execution_time_ms=int((time.time() - start_time) * 1000)
            )
    
    async def get_databases(self) -> Dict[str, Any]:
        """List configured databases"""
        result = await self._send_request("tools/call", {
            "name": "sql_list_databases",
            "arguments": {}
        })
        return result
    
    async def get_schema(self, database: str, table: str = None) -> Dict[str, Any]:
        """Get database or table schema information"""
        result = await self._send_request("tools/call", {
            "name": "sql_get_schema",
            "arguments": {
                "database": database,
                "table": table
            }
        })
        return result

async def main():
    """Example usage of Argos Client"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    logger = logging.getLogger(__name__)
    
    # Initialize client
    client = SQLMCPClient("ws://localhost:3001")
    
    try:
        # Connect to server
        if not await client.connect():
            logger.error("Failed to connect to Argos")
            return
        
        # Demonstrate various operations
        logger.info("=== Argos Integration Demo ===")
        
        # 1. List available tools
        tools = await client.list_tools()
        logger.info(f"Available tools: {[tool['name'] for tool in tools]}")
        
        # 2. List databases
        databases = await client.get_databases()
        logger.info(f"Available databases: {list(databases.get('databases', {}).keys())}")
        
        # 3. Execute sample queries
        if "demo" in databases.get("databases", {}):
            logger.info("=== Executing Demo Queries ===")
            
            # Simple query
            result = await client.query("demo", "SELECT COUNT(*) as user_count FROM users")
            if result.success:
                logger.info(f"User count: {result.rows[0]['user_count']}")
            
            # Complex analytical query
            analytical_query = """
            SELECT 
                d.name as department,
                COUNT(u.id) as user_count,
                AVG(u.salary) as avg_salary
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
            GROUP BY d.name
            ORDER BY user_count DESC
            """
            
            result = await client.query("demo", analytical_query)
            if result.success:
                logger.info(f"Department analysis: {len(result.rows)} departments analyzed")
                for row in result.rows[:3]:  # Show top 3
                    logger.info(f"  {row['department']}: {row['user_count']} users")
        
        logger.info("=== Demo completed successfully ===")
        
    except Exception as e:
        logger.error(f"Demo failed: {e}")
    
    finally:
        await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
