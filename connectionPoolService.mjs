// import express from "express";
// import cors from "cors";
// import { Pool } from "pg";
// import dotenv from "dotenv";

// dotenv.config();

// class ConnectionPool {
//   constructor() {
//     this.pools = new Map();
//     this.activeConnections = new Map(); // requestId → connection object
//     this.waitingQueue = new Map();

//     // Database configuration with read replicas
//     this.dbConnectionStrings = {
//       // Primary
//       india_customer_write: process.env.INDIA_CUSTOMER_WRITE_DB_URI,
//       // Read replicas
//       india_customer_read: [
//         process.env.INDIA_CUSTOMER_READ1_DB_URI,
//         process.env.INDIA_CUSTOMER_READ2_DB_URI,
//         process.env.INDIA_CUSTOMER_READ3_DB_URI,
//         process.env.INDIA_CUSTOMER_READ4_DB_URI,
//       ].filter(Boolean),
//     };

//     // Load balancer state
//     this.loadBalancer = {
//       roundRobinIndex: new Map(),
//       replicaHealth: new Map(),
//       connectionCounts: new Map(),
//     };

//     this.config = {
//       maxConnectionsPerPool: 5000,
//       maxIdleConnections: 1000,
//       connectionTimeout: 30 * 1000, // 30 seconds
//       idleTimeout: 30 * 60 * 1000, // 5 minutes
//       maxConnectionAge: 30 * 60 * 1000, // 30 minutes
//       cleanupInterval: 60 * 1000, // 60 seconds
//       maxWaitingRequests: 1000,
//       healthCheckInterval: 30 * 1000, // 30 seconds
//       failoverThreshold: 5, // 5 retries
//       maxConnectionsPerReplica: 5000,
//     };

//     this.globalStats = {
//       totalConnections: 0,
//       activeConnections: 0,
//       connectionReuses: 0,
//       poolsCreated: 0,
//       connectionsExpired: 0,
//       requestsQueued: 0,
//       requestsRejected: 0,
//       readRequests: 0,
//       writeRequests: 0,
//       replicaHits: new Map(),
//     };

//     this.initializeLoadBalancer();
//     this.startCleanupProcess();
//   }

//   initializeLoadBalancer() {
//     Object.keys(this.dbConnectionStrings).forEach((key) => {
//       if (key.includes("_read")) {
//         const replicas = Array.isArray(this.dbConnectionStrings[key])
//           ? this.dbConnectionStrings[key]
//           : [this.dbConnectionStrings[key]];

//         this.loadBalancer.roundRobinIndex.set(key, 0);
//         this.loadBalancer.connectionCounts.set(
//           key,
//           new Array(replicas.length).fill(0)
//         );

//         replicas.forEach((replica, index) => {
//           const healthKey = `${key}_${index}`;

//           this.loadBalancer.replicaHealth.set(healthKey, {
//             healthy: true,
//             errorCount: 0,
//             lastCheck: Date.now(),
//             uri: replica,
//           });
//           this.globalStats.replicaHits.set(healthKey, 0);
//         });
//       }
//     });
//   }

//   getOptimalReadReplica(country, resource) {
//     const key = `${country}_${resource}_read`;
//     const replicas = this.dbConnectionStrings[key];

//     if (!Array.isArray(replicas) || replicas.length === 0) {
//       return {
//         uri: this.dbConnectionStrings[`${country}_${resource}_write`],
//         replicaId: "primary",
//       };
//     }

//     if (replicas.length === 1) {
//       return {
//         uri: replicas[0],
//         replicaId: `${key}_0`,
//       };
//     }

//     // Get healthy replicas
//     const healthyReplicas = [];
//     const connectionCounts = this.loadBalancer.connectionCounts.get(key) || [];

//     replicas.forEach((replica, index) => {
//       const healthKey = `${key}_${index}`;
//       const health = this.loadBalancer.replicaHealth.get(healthKey);

//       if (!health || health.healthy !== false) {
//         const connections = connectionCounts[index] || 0;

//         // Calculate weight based on number of connections
//         const weight = Math.max(1, 100 - connections);

//         healthyReplicas.push({
//           replica,
//           index,
//           healthKey,
//           connections,
//           weight,
//         });
//       }
//     });

//     if (healthyReplicas.length === 0) {
//       console.warn(`[LB] No healthy replicas for ${key}, using primary`);
//       return {
//         uri: this.dbConnectionStrings[`${country}_${resource}_write`],
//         replicaId: "primary_fallback",
//       };
//     }

//     // Weighted selection
//     const totalWeight = healthyReplicas.reduce(
//       (sum, replica) => sum + replica.weight,
//       0
//     );

//     let random = Math.random() * totalWeight;

//     let selectedReplica = healthyReplicas[0]; // fallback

//     for (const replica of healthyReplicas) {
//       random -= replica.weight;
//       if (random <= 0) {
//         selectedReplica = replica;
//         break;
//       }
//     }

//     console.log(
//       `[LB] Selected replica: ${selectedReplica.healthKey} (${selectedReplica.connections} connections)`
//     );

//     return {
//       uri: selectedReplica.replica,
//       replicaId: selectedReplica.healthKey,
//     };
//   }

//   updateReplicaConnectionCount(replicaId, delta) {
//     if (replicaId === "primary" || replicaId === "primary_fallback") return;

//     // Better parsing of replicaId
//     const parts = replicaId.split("_");
//     if (parts.length < 4) {
//       console.warn(`[LB] Invalid replicaId format: ${replicaId}`);
//       return;
//     }

//     // Extract key and index
//     const index = parseInt(parts[parts.length - 1]);
//     const key = parts.slice(0, -1).join("_");

//     if (isNaN(index)) {
//       console.warn(`[LB] Invalid replica index in: ${replicaId}`);
//       return;
//     }

//     let counts = this.loadBalancer.connectionCounts.get(key);

//     if (counts[index] !== undefined) {
//       counts[index] = Math.max(0, counts[index] + delta);
//     } else {
//       console.warn(
//         `[LB] Index ${index} out of bounds for ${key} (length: ${counts.length})`
//       );
//     }
//   }

//   getDbUri(country, resource, operation = "read") {
//     this.globalStats.readRequests++;
//     const result = this.getOptimalReadReplica(country, resource);

//     this.globalStats.replicaHits.set(
//       result.replicaId,
//       (this.globalStats.replicaHits.get(result.replicaId) || 0) + 1
//     );

//     return result;
//   }

//   async acquireConnection(requestId, country, resource, operation = "read") {
//     // Check if connection already exists for this request
//     if (this.activeConnections.has(requestId)) {
//       const existingConn = this.activeConnections.get(requestId);
//       existingConn.usageCount++;
//       this.globalStats.connectionReuses++;
//       return existingConn;
//     }

//     console.log(`[POOL] Acquiring connection...`);

//     const { uri, replicaId } = this.getDbUri(country, resource, operation);
//     const poolKey = `${country}_${resource}_${replicaId}`;

//     let pool = this.pools.get(poolKey);

//     console.log(`[POOL] Checking pool`);

//     if (!pool) {
//       pool = this.createConnectionPool(country, resource, uri, replicaId);
//       this.pools.set(poolKey, pool);
//     }

//     pool.lastActivity = new Date();

//     const availableConnection = pool.connections.find(
//       (conn) => !conn.isActive && !this.isConnectionExpired(conn)
//     );

//     if (availableConnection) {
//       console.log(
//         `[POOL] Activating available connection: ${availableConnection.id}`
//       );

//       return this.activateConnection(
//         availableConnection,
//         requestId,
//         pool,
//         replicaId
//       );
//     }

//     const activeCount = pool.connections.filter((conn) => conn.isActive).length;
//     if (activeCount < this.config.maxConnectionsPerReplica) {
//       return this.createNewConnection(requestId, uri, pool, replicaId);
//     }

//     console.log(`[POOL] Pool exhausted for ${poolKey}`);
//     return this.handlePoolExhaustion(requestId, poolKey);
//   }

//   async createNewConnection(requestId, dbUri, pool, replicaId) {
//     const connectionId = `conn_${pool.country}_${
//       pool.resource
//     }_${replicaId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

//     console.log(
//       `[POOL] Creating NEW connection, connectionId: ${connectionId}`
//     );

//     const pgPool = new Pool({
//       connectionString: dbUri,
//       max: this.config.maxConnectionsPerReplica,
//       min: 5,
//       application_name: `microservice_pool_${connectionId}`,
//       keepAlive: true,
//     });

//     try {
//       // const testClient = await pgPool.connect();
//       // await testClient.query("SELECT NOW()");
//       // testClient.release();

//       const connection = {
//         id: connectionId,
//         country: pool.country,
//         resource: pool.resource,
//         replicaId,
//         dbUri: dbUri.replace(/\/\/.*@/, " //***:***@"),
//         requestId,
//         pgPool,
//         createdAt: new Date(),
//         lastUsed: new Date(),
//         usageCount: 1,
//         isActive: true,
//       };

//       pool.connections.push(connection);
//       // Store connection by requestId
//       this.activeConnections.set(requestId, connection);

//       pool.stats.totalCreated++;
//       pool.stats.currentActive++;
//       this.globalStats.totalConnections++;
//       this.globalStats.activeConnections++;
//       this.updateReplicaConnectionCount(replicaId, 1);

//       console.log(
//         `[POOL] Created connection: ${connectionId} for request: ${requestId} | Total: ${this.globalStats.totalConnections}, Active: ${this.globalStats.activeConnections}`
//       );

//       return connection;
//     } catch (error) {
//       console.error(`[POOL] Failed to connect to ${replicaId}:`, error.message);

//       const health = this.loadBalancer.replicaHealth.get(replicaId);
//       if (health) {
//         health.errorCount++;
//         if (health.errorCount >= this.config.failoverThreshold) {
//           health.healthy = false;
//           console.warn(`[LB] Marking replica ${replicaId} as unhealthy`);
//         }
//       }

//       await pgPool.end().catch(() => {});
//       throw error;
//     }
//   }

//   createConnectionPool(country, resource, dbUri, replicaId) {
//     const poolKey = `${country}_${resource}_${replicaId}`;
//     console.log(`[POOL] Creating pool`);

//     const pool = {
//       country,
//       resource,
//       replicaId,
//       dbUri: dbUri.replace(/\/\/.*@/, "//***:***@"),
//       connections: [],
//       createdAt: new Date(),
//       lastActivity: new Date(),
//       stats: {
//         totalCreated: 0,
//         currentActive: 0,
//         currentIdle: 0,
//         totalReuses: 0,
//         peakActive: 0,
//       },
//     };

//     this.globalStats.poolsCreated++;
//     return pool;
//   }

//   activateConnection(connection, requestId, pool) {
//     connection.isActive = true;
//     connection.requestId = requestId;
//     connection.usageCount++;
//     connection.lastUsed = new Date();

//     // Store connection by requestId
//     this.activeConnections.set(requestId, connection);
//     pool.stats.currentActive++;
//     pool.stats.currentIdle--;
//     pool.stats.totalReuses++;
//     this.globalStats.connectionReuses++;
//     this.globalStats.activeConnections++;

//     console.log(`[POOL] Reusing connection: ${connection.id}`);
//     return connection;
//   }

//   async releaseConnection(requestId) {
//     const connection = this.activeConnections.get(requestId);
//     if (!connection) {
//       console.log(`[POOL] No connection found for request: ${requestId}`);
//       return false;
//     }

//     console.log(`[POOL] Releasing connection: ${connection.id}`);

//     connection.isActive = false;
//     connection.requestId = null;
//     connection.lastUsed = new Date();

//     // Remove from requestId mapping
//     this.activeConnections.delete(requestId);
//     this.globalStats.activeConnections--;
//     this.updateReplicaConnectionCount(connection.replicaId, -1);

//     const poolKey = `${connection.country}_${connection.resource}_${connection.replicaId}`;
//     const pool = this.pools.get(poolKey);
//     if (pool) {
//       pool.stats.currentActive--;
//       pool.stats.currentIdle++;
//       pool.lastActivity = new Date();
//     }

//     return true;
//   }

//   async executeQuery(requestId, sql, params = []) {
//     const connection = this.activeConnections.get(requestId);
//     if (!connection) {
//       throw new Error(`No active connection found for request: ${requestId}`);
//     }

//     try {
//       const client = await connection.pgPool.connect();

//       let result;
//       try {
//         result = await client.query(sql, params);
//       } finally {
//         client.release();
//       }

//       return {
//         rows: result.rows,
//         rowCount: result.rowCount,
//         connectionId: connection.id,
//         replicaId: connection.replicaId,
//         executedAt: new Date(),
//         requestId: requestId,
//       };
//     } catch (error) {
//       console.error(`[POOL] Query execution failed:`, error.message);
//       throw error;
//     }
//   }

//   isConnectionExpired(connection) {
//     const age = Date.now() - connection.createdAt.getTime();
//     const idleTime = Date.now() - connection.lastUsed.getTime();

//     return (
//       age > this.config.maxConnectionAge ||
//       (!connection.isActive && idleTime > this.config.idleTimeout)
//     );
//   }

//   startCleanupProcess() {
//     setInterval(async () => {
//       console.log(`[POOL] Running cleanup...`);

//       for (const [poolKey, pool] of this.pools.entries()) {
//         const expiredConnections = pool.connections.filter((conn) =>
//           this.isConnectionExpired(conn)
//         );

//         for (const conn of expiredConnections) {
//           console.log(`[POOL] Closing expired connection: ${conn.id}`);
//           try {
//             await conn.pgPool.end();
//             this.updateReplicaConnectionCount(conn.replicaId, -1);
//           } catch (error) {
//             console.error(`Error closing expired connection:`, error.message);
//           }

//           pool.connections = pool.connections.filter((c) => c.id !== conn.id);

//           if (conn.isActive) {
//             this.activeConnections.delete(conn.requestId);
//             pool.stats.currentActive--;
//             this.globalStats.activeConnections--;
//           } else {
//             pool.stats.currentIdle--;
//           }

//           this.globalStats.connectionsExpired++;
//           this.globalStats.totalConnections--;
//         }
//       }
//     }, this.config.cleanupInterval);
//   }

//   async handlePoolExhaustion(requestId, poolKey) {
//     console.log(
//       `[POOL] Pool exhausted for ${poolKey}, queueing request ${requestId}`
//     );
//     this.globalStats.requestsQueued++;
//     throw new Error(`Connection pool exhausted for ${poolKey}`);
//   }

//   getDetailedStats() {
//     const poolStats = {};
//     for (const [poolKey, pool] of this.pools.entries()) {
//       poolStats[poolKey] = {
//         totalConnections: pool.connections.length,
//         activeConnections: pool.stats.currentActive,
//         idleConnections: pool.stats.currentIdle,
//         replicaId: pool.replicaId,
//       };
//     }

//     return {
//       global: this.globalStats,
//       pools: poolStats,
//       loadBalancer: {
//         healthyReplicas: Array.from(
//           this.loadBalancer.replicaHealth.entries()
//         ).filter(([_, health]) => health.healthy).length,
//         totalReplicas: this.loadBalancer.replicaHealth.size,
//         replicaDistribution: Object.fromEntries(this.globalStats.replicaHits),
//       },
//       activeRequestConnections: this.activeConnections.size,
//     };
//   }
// }

// const pool = new ConnectionPool();
// const app = express();
// app.use(cors());
// app.use(express.json());

// // Acquire connection endpoint
// app.post("/connection/acquire", async (req, res) => {
//   const { requestId, country, resource, operation = "read" } = req.body;

//   try {
//     const connection = await pool.acquireConnection(
//       requestId,
//       country,
//       resource,
//       operation
//     );

//     res.json({
//       connectionId: connection.id,
//       replicaId: connection.replicaId,
//       dbUri: connection.dbUri,
//       usageCount: connection.usageCount,
//       isReused: connection.usageCount > 1,
//       operation,
//       shared: true, // Indicates connection sharing is active
//     });
//   } catch (error) {
//     console.error(`[POOL] Connection failed:`, error.message);
//     res.status(503).json({ error: error.message });
//   }
// });

// // Release connection endpoint
// app.post("/connection/release", async (req, res) => {
//   const { requestId } = req.body;
//   const released = await pool.releaseConnection(requestId);
//   res.json({ success: released });
// });

// // Execute query endpoint - simplified for shared connections
// app.post("/connection/execute", async (req, res) => {
//   const { requestId, sql, params = [] } = req.body;

//   try {
//     const result = await pool.executeQuery(requestId, sql, params);
//     res.json(result);
//   } catch (error) {
//     console.error(`[POOL] Query execution failed:`, error.message);
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get("/stats", (req, res) => {
//   res.json(pool.getDetailedStats());
// });

// app.listen(3004);

import express from "express";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

class ConnectionPool {
  constructor() {
    this.pools = new Map();
    this.activeConnections = new Map(); // requestId → connection object
    this.waitingQueue = new Map();

    // Database configuration with read replicas
    this.dbConnectionStrings = {
      // Primary
      india_customer_write: process.env.INDIA_CUSTOMER_WRITE_DB_URI,
      // Read replicas
      india_customer_read: [
        process.env.INDIA_CUSTOMER_READ1_DB_URI,
        process.env.INDIA_CUSTOMER_READ2_DB_URI,
        process.env.INDIA_CUSTOMER_READ3_DB_URI,
        process.env.INDIA_CUSTOMER_READ4_DB_URI,
      ].filter(Boolean),
    };

    // Load balancer state
    this.loadBalancer = {
      roundRobinIndex: new Map(),
      replicaHealth: new Map(),
      connectionCounts: new Map(),
    };

    this.config = {
      maxConnectionsPerPool: 5000,
      maxIdleConnections: 1000,
      connectionTimeout: 30 * 1000, // 30 seconds
      idleTimeout: 30 * 60 * 1000, // 5 minutes
      maxConnectionAge: 30 * 60 * 1000, // 30 minutes
      cleanupInterval: 60 * 1000, // 60 seconds
      maxWaitingRequests: 1000,
      healthCheckInterval: 30 * 1000, // 30 seconds
      failoverThreshold: 5, // 5 retries
      maxConnectionsPerReplica: 5000,
    };

    this.globalStats = {
      totalConnections: 0,
      activeConnections: 0,
      connectionReuses: 0,
      poolsCreated: 0,
      connectionsExpired: 0,
      requestsQueued: 0,
      requestsRejected: 0,
      readRequests: 0,
      writeRequests: 0,
      replicaHits: new Map(),
    };

    this.initializeLoadBalancer();
    this.startCleanupProcess();
  }

  initializeLoadBalancer() {
    Object.keys(this.dbConnectionStrings).forEach((key) => {
      if (key.includes("_read")) {
        const replicas = Array.isArray(this.dbConnectionStrings[key])
          ? this.dbConnectionStrings[key]
          : [this.dbConnectionStrings[key]];

        this.loadBalancer.roundRobinIndex.set(key, 0);
        this.loadBalancer.connectionCounts.set(
          key,
          new Array(replicas.length).fill(0)
        );

        replicas.forEach((replica, index) => {
          const healthKey = `${key}_${index}`;

          this.loadBalancer.replicaHealth.set(healthKey, {
            healthy: true,
            errorCount: 0,
            lastCheck: Date.now(),
            uri: replica,
          });
          this.globalStats.replicaHits.set(healthKey, 0);
        });
      }
    });
  }

  getOptimalReadReplica(country, resource) {
    const key = `${country}_${resource}_read`;
    const replicas = this.dbConnectionStrings[key];

    if (!Array.isArray(replicas) || replicas.length === 0) {
      return {
        uri: this.dbConnectionStrings[`${country}_${resource}_write`],
        replicaId: "primary",
      };
    }

    if (replicas.length === 1) {
      return {
        uri: replicas[0],
        replicaId: `${key}_0`,
      };
    }

    // Get healthy replicas
    const healthyReplicas = [];
    const connectionCounts = this.loadBalancer.connectionCounts.get(key) || [];

    replicas.forEach((replica, index) => {
      const healthKey = `${key}_${index}`;
      const health = this.loadBalancer.replicaHealth.get(healthKey);

      if (!health || health.healthy !== false) {
        const connections = connectionCounts[index] || 0;

        // Calculate weight based on number of connections
        const weight = Math.max(1, 100 - connections);

        healthyReplicas.push({
          replica,
          index,
          healthKey,
          connections,
          weight,
        });
      }
    });

    if (healthyReplicas.length === 0) {
      console.warn(`[LB] No healthy replicas for ${key}, using primary`);
      return {
        uri: this.dbConnectionStrings[`${country}_${resource}_write`],
        replicaId: "primary_fallback",
      };
    }

    // Weighted selection
    const totalWeight = healthyReplicas.reduce(
      (sum, replica) => sum + replica.weight,
      0
    );

    let random = Math.random() * totalWeight;

    let selectedReplica = healthyReplicas[0]; // fallback

    for (const replica of healthyReplicas) {
      random -= replica.weight;
      if (random <= 0) {
        selectedReplica = replica;
        break;
      }
    }

    console.log(
      `[LB] Selected replica: ${selectedReplica.healthKey} (${selectedReplica.connections} connections)`
    );

    return {
      uri: selectedReplica.replica,
      replicaId: selectedReplica.healthKey,
    };
  }

  updateReplicaConnectionCount(replicaId, delta) {
    if (replicaId === "primary" || replicaId === "primary_fallback") return;

    // Better parsing of replicaId
    const parts = replicaId.split("_");
    if (parts.length < 4) {
      console.warn(`[LB] Invalid replicaId format: ${replicaId}`);
      return;
    }

    // Extract key and index
    const index = parseInt(parts[parts.length - 1]);
    const key = parts.slice(0, -1).join("_");

    if (isNaN(index)) {
      console.warn(`[LB] Invalid replica index in: ${replicaId}`);
      return;
    }

    let counts = this.loadBalancer.connectionCounts.get(key);

    if (counts[index] !== undefined) {
      counts[index] = Math.max(0, counts[index] + delta);
    } else {
      console.warn(
        `[LB] Index ${index} out of bounds for ${key} (length: ${counts.length})`
      );
    }
  }

  getDbUri(country, resource, operation = "read") {
    this.globalStats.readRequests++;
    const result = this.getOptimalReadReplica(country, resource);

    this.globalStats.replicaHits.set(
      result.replicaId,
      (this.globalStats.replicaHits.get(result.replicaId) || 0) + 1
    );

    return result;
  }

  async acquireConnection(requestId, country, resource, operation = "read") {
    // Check if connection already exists for this request
    if (this.activeConnections.has(requestId)) {
      const existingConn = this.activeConnections.get(requestId);
      existingConn.usageCount++;
      this.globalStats.connectionReuses++;
      return existingConn;
    }

    console.log(`[POOL] Acquiring connection...`);

    const { uri, replicaId } = this.getDbUri(country, resource, operation);
    const poolKey = `${country}_${resource}_${replicaId}`;

    let pool = this.pools.get(poolKey);

    console.log(`[POOL] Checking pool`);

    if (!pool) {
      pool = this.createConnectionPool(country, resource, uri, replicaId);
      this.pools.set(poolKey, pool);
    }

    pool.lastActivity = new Date();

    const availableConnection = pool.connections.find(
      (conn) => !conn.isActive && !this.isConnectionExpired(conn)
    );

    if (availableConnection) {
      console.log(
        `[POOL] Activating available connection: ${availableConnection.id}`
      );

      return this.activateConnection(
        availableConnection,
        requestId,
        pool,
        replicaId
      );
    }

    const activeCount = pool.connections.filter((conn) => conn.isActive).length;
    if (activeCount < this.config.maxConnectionsPerReplica) {
      return this.createNewConnection(requestId, uri, pool, replicaId);
    }

    console.log(`[POOL] Pool exhausted for ${poolKey}`);
    return this.handlePoolExhaustion(requestId, poolKey);
  }

  async createNewConnection(requestId, dbUri, pool, replicaId) {
    const connectionId = `conn_${pool.country}_${
      pool.resource
    }_${replicaId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

    console.log(
      `[POOL] Creating NEW connection, connectionId: ${connectionId}`
    );

    const pgPool = new Pool({
      connectionString: dbUri,
      max: this.config.maxConnectionsPerReplica,
      min: 5,
      application_name: `microservice_pool_${connectionId}`,
      keepAlive: true,
    });

    try {
      const connection = {
        id: connectionId,
        country: pool.country,
        resource: pool.resource,
        replicaId,
        dbUri: dbUri.replace(/\/\/.*@/, " //***:***@"),
        requestId,
        pgPool,
        createdAt: new Date(),
        lastUsed: new Date(),
        usageCount: 1,
        isActive: true,
      };

      pool.connections.push(connection);
      // Store connection by requestId
      this.activeConnections.set(requestId, connection);

      pool.stats.totalCreated++;
      pool.stats.currentActive++;
      this.globalStats.totalConnections++;
      this.globalStats.activeConnections++;
      this.updateReplicaConnectionCount(replicaId, 1);

      console.log(
        `[POOL] Created connection: ${connectionId} for request: ${requestId} | Total: ${this.globalStats.totalConnections}, Active: ${this.globalStats.activeConnections}`
      );

      return connection;
    } catch (error) {
      console.error(`[POOL] Failed to connect to ${replicaId}:`, error.message);

      const health = this.loadBalancer.replicaHealth.get(replicaId);
      if (health) {
        health.errorCount++;
        if (health.errorCount >= this.config.failoverThreshold) {
          health.healthy = false;
          console.warn(`[LB] Marking replica ${replicaId} as unhealthy`);
        }
      }

      await pgPool.end().catch(() => {});
      throw error;
    }
  }

  createConnectionPool(country, resource, dbUri, replicaId) {
    const poolKey = `${country}_${resource}_${replicaId}`;
    console.log(`[POOL] Creating pool`);

    const pool = {
      country,
      resource,
      replicaId,
      dbUri: dbUri.replace(/\/\/.*@/, "//***:***@"),
      connections: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      stats: {
        totalCreated: 0,
        currentActive: 0,
        currentIdle: 0,
        totalReuses: 0,
        peakActive: 0,
      },
    };

    this.globalStats.poolsCreated++;
    return pool;
  }

  activateConnection(connection, requestId, pool) {
    connection.isActive = true;
    connection.requestId = requestId;
    connection.usageCount++;
    connection.lastUsed = new Date();

    // Store connection by requestId
    this.activeConnections.set(requestId, connection);
    pool.stats.currentActive++;
    pool.stats.currentIdle--;
    pool.stats.totalReuses++;
    this.globalStats.connectionReuses++;
    this.globalStats.activeConnections++;

    console.log(`[POOL] Reusing connection: ${connection.id}`);
    return connection;
  }

  async releaseConnection(requestId) {
    const connection = this.activeConnections.get(requestId);
    if (!connection) {
      console.log(`[POOL] No connection found for request: ${requestId}`);
      return false;
    }

    console.log(`[POOL] Releasing connection: ${connection.id}`);

    connection.isActive = false;
    connection.requestId = null;
    connection.lastUsed = new Date();

    // Remove from requestId mapping
    this.activeConnections.delete(requestId);
    this.globalStats.activeConnections--;
    this.updateReplicaConnectionCount(connection.replicaId, -1);

    const poolKey = `${connection.country}_${connection.resource}_${connection.replicaId}`;
    const pool = this.pools.get(poolKey);
    if (pool) {
      pool.stats.currentActive--;
      pool.stats.currentIdle++;
      pool.lastActivity = new Date();
    }

    return true;
  }

  async executeQuery(requestId, sql, params = []) {
    const connection = this.activeConnections.get(requestId);
    if (!connection) {
      throw new Error(`No active connection found for request: ${requestId}`);
    }

    try {
      const client = await connection.pgPool.connect();

      let result;
      try {
        result = await client.query(sql, params);
      } finally {
        client.release();
      }

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        connectionId: connection.id,
        replicaId: connection.replicaId,
        executedAt: new Date(),
        requestId: requestId,
      };
    } catch (error) {
      console.error(`[POOL] Query execution failed:`, error.message);
      throw error;
    }
  }

  isConnectionExpired(connection) {
    const age = Date.now() - connection.createdAt.getTime();
    const idleTime = Date.now() - connection.lastUsed.getTime();

    return (
      age > this.config.maxConnectionAge ||
      (!connection.isActive && idleTime > this.config.idleTimeout)
    );
  }

  startCleanupProcess() {
    setInterval(async () => {
      console.log(`[POOL] Running cleanup...`);

      for (const [poolKey, pool] of this.pools.entries()) {
        const expiredConnections = pool.connections.filter((conn) =>
          this.isConnectionExpired(conn)
        );

        for (const conn of expiredConnections) {
          console.log(`[POOL] Closing expired connection: ${conn.id}`);
          try {
            await conn.pgPool.end();
            this.updateReplicaConnectionCount(conn.replicaId, -1);
          } catch (error) {
            console.error(`Error closing expired connection:`, error.message);
          }

          pool.connections = pool.connections.filter((c) => c.id !== conn.id);

          if (conn.isActive) {
            this.activeConnections.delete(conn.requestId);
            pool.stats.currentActive--;
            this.globalStats.activeConnections--;
          } else {
            pool.stats.currentIdle--;
          }

          this.globalStats.connectionsExpired++;
          this.globalStats.totalConnections--;
        }
      }
    }, this.config.cleanupInterval);
  }

  async handlePoolExhaustion(requestId, poolKey) {
    console.log(
      `[POOL] Pool exhausted for ${poolKey}, queueing request ${requestId}`
    );
    this.globalStats.requestsQueued++;
    throw new Error(`Connection pool exhausted for ${poolKey}`);
  }

  getDetailedStats() {
    const poolStats = {};
    for (const [poolKey, pool] of this.pools.entries()) {
      poolStats[poolKey] = {
        totalConnections: pool.connections.length,
        activeConnections: pool.stats.currentActive,
        idleConnections: pool.stats.currentIdle,
        replicaId: pool.replicaId,
      };
    }

    return {
      global: this.globalStats,
      pools: poolStats,
      loadBalancer: {
        healthyReplicas: Array.from(
          this.loadBalancer.replicaHealth.entries()
        ).filter(([_, health]) => health.healthy).length,
        totalReplicas: this.loadBalancer.replicaHealth.size,
        replicaDistribution: Object.fromEntries(this.globalStats.replicaHits),
      },
      activeRequestConnections: this.activeConnections.size,
    };
  }
}

const pool = new ConnectionPool();
const app = express();
app.use(cors());
app.use(express.json());

// Acquire connection endpoint
app.post("/connection/acquire", async (req, res) => {
  const { requestId, country, resource, operation = "read" } = req.body;

  try {
    const connection = await pool.acquireConnection(
      requestId,
      country,
      resource,
      operation
    );

    res.json({
      connectionId: connection.id,
      replicaId: connection.replicaId,
      dbUri: connection.dbUri,
      usageCount: connection.usageCount,
      isReused: connection.usageCount > 1,
      operation,
      shared: true, // Indicates connection sharing is active
    });
  } catch (error) {
    console.error(`[POOL] Connection failed:`, error.message);
    res.status(503).json({ error: error.message });
  }
});

// Release connection endpoint
app.post("/connection/release", async (req, res) => {
  const { requestId } = req.body;
  const released = await pool.releaseConnection(requestId);
  res.json({ success: released });
});

// Execute query endpoint - simplified for shared connections
app.post("/connection/execute", async (req, res) => {
  const { requestId, sql, params = [] } = req.body;

  try {
    const result = await pool.executeQuery(requestId, sql, params);
    res.json(result);
  } catch (error) {
    console.error(`[POOL] Query execution failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/stats", (req, res) => {
  res.json(pool.getDetailedStats());
});

app.listen(3004);
