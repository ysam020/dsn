import axios from "axios";

class DatabaseWrapper {
  constructor() {
    this.connectionCache = new Map();
  }

  async getConnection(
    requestId,
    country = "india",
    resource = "customer",
    operation = "read"
  ) {
    // Check if we already have connection proxy cached
    if (this.connectionCache.has(requestId)) {
      const cached = this.connectionCache.get(requestId);
      return cached.proxy;
    }

    try {
      // Get connection from pool service
      const response = await axios.post(
        `http://localhost:3004/connection/acquire`,
        {
          requestId,
          country,
          resource,
          operation,
        }
      );
      console.log(`[DB_WRAPPER] Response`, response.data);

      const connectionInfo = response.data;

      // Create connection proxy object shared across services
      const connectionProxy = {
        requestId,
        connectionId: connectionInfo.connectionId,
        replicaId: connectionInfo.replicaId,
        operation,
        isReused: connectionInfo.isReused,
        usageCount: connectionInfo.usageCount,

        // Main query method
        async query(sql, params = []) {
          try {
            const result = await axios.post(
              `http://localhost:3004/connection/execute`,
              {
                requestId,
                sql,
                params,
              }
            );

            return {
              rows: result.data.rows,
              rowCount: result.data.rowCount,
              connectionId: result.data.connectionId,
              replicaId: result.data.replicaId,
              executedAt: result.data.executedAt,
            };
          } catch (error) {
            console.error(
              `[DB_WRAPPER] Query failed for request ${requestId}:`,
              error.message
            );
            throw new Error(
              `Database query failed: ${
                error.response?.data?.error || error.message
              }`
            );
          }
        },
      };

      // Cache the connection info and proxy
      this.connectionCache.set(requestId, {
        connectionInfo,
        proxy: connectionProxy,
        createdAt: new Date(),
      });

      const connectionStatus = connectionInfo.isReused ? "reused" : "created";
      console.log(
        `[DB_WRAPPER] Connection proxy ${connectionStatus} for request ${requestId}`
      );

      return connectionProxy;
    } catch (error) {
      console.error(
        `[DB_WRAPPER] Failed to acquire connection for request ${requestId}:`,
        error.message
      );
      throw new Error(
        `Database connection failed: ${
          error.response?.data?.error || error.message
        }`
      );
    }
  }

  // Clear expired connections from cache
  clearExpiredConnections(maxAge = 30 * 60 * 1000) {
    // 30 minutes
    const now = new Date();
    for (const [requestId, cached] of this.connectionCache.entries()) {
      if (now - cached.createdAt > maxAge) {
        console.log(
          `[DB_WRAPPER] Clearing expired cache entry for request ${requestId}`
        );
        this.connectionCache.delete(requestId);
      }
    }
  }

  // Get statistics
  getStats() {
    return {
      cachedConnections: this.connectionCache.size,
      cacheEntries: Array.from(this.connectionCache.entries()).map(
        ([requestId, cached]) => ({
          requestId,
          connectionId: cached.connectionInfo.connectionId,
          replicaId: cached.connectionInfo.replicaId,
          createdAt: cached.createdAt,
          usageCount: cached.connectionInfo.usageCount,
        })
      ),
    };
  }
}

export const dbWrapper = new DatabaseWrapper();

// Start cleanup process
setInterval(() => {
  dbWrapper.clearExpiredConnections();
}, 60000); // Clean every minute

export default DatabaseWrapper;
