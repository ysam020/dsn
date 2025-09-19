// import express from "express";
// import cors from "cors";
// import axios from "axios";
// import { redis } from "./redis.mjs";
// import cluster from "cluster";
// import os from "os";

// if (cluster.isPrimary) {
//   const numCPUs = os.cpus().length;
//   for (let i = 0; i < numCPUs; i++) {
//     cluster.fork();
//   }
// } else {
//   const app = express();
//   app.use(cors());
//   app.use(express.json());

//   // Database selection middleware
//   const dbMiddleware = async (req, res, next) => {
//     try {
//       const country = req.headers["x-country"]?.toLowerCase() || "india";
//       const resource = req.headers["x-resource"]?.toLowerCase() || "customer";
//       const requestId = `req_${Date.now()}_${Math.random()
//         .toString(36)
//         .substring(2, 5)}`;

//       // Determine operation type based on HTTP method
//       const operation = req.method === "GET" ? "read" : "write";

//       // Set up request context
//       req.dbInfo = { requestId, country, resource, operation };
//       req.headers["x-request-id"] = requestId;

//       next();
//     } catch (error) {
//       console.error(`[GATEWAY] Database connection failed:`, error.message);
//       res.status(503).json({
//         error: "Database connection failed",
//         details: error.message,
//       });
//     }
//   };

//   // Connection release middleware
//   const releaseConnection = (req, res, next) => {
//     res.on("finish", async () => {
//       if (req.dbInfo?.requestId) {
//         try {
//           await axios.post("http://localhost:3004/connection/release", {
//             requestId: req.dbInfo.requestId,
//           });
//           console.log(
//             `[GATEWAY] Released connection for ${req.dbInfo.requestId}`
//           );
//           console.log(`===============`);
//         } catch (error) {
//           console.warn(
//             `[GATEWAY] Failed to release connection:`,
//             error.message
//           );
//         }
//       }
//     });
//     next();
//   };

//   app.use(dbMiddleware);
//   app.use(releaseConnection);

//   // Get dashboard data
//   app.get("/user/:user_id/dashboard/:month", async (req, res) => {
//     const { user_id, month } = req.params;
//     const { requestId } = req.dbInfo;

//     try {
//       const cacheKey = `dashboard:${user_id}:${month}`;
//       const cachedData = await redis.get(cacheKey).catch(() => null);
//       const chance = Math.floor(Math.random() * 100);

//       if (cachedData && chance < 80) {
//         // 80% chance to use cache if available
//         return res.json(JSON.parse(cachedData));
//       }

//       const [userResponse, attendanceResponse, leavesResponse] =
//         await Promise.all([
//           axios.get(`http://localhost:3001/user/${user_id}`, {
//             headers: {
//               "x-request-id": requestId,
//               "x-country": req.dbInfo.country,
//               "x-resource": req.dbInfo.resource,
//             },
//           }),
//           axios.get(`http://localhost:3002/attendance/${user_id}/${month}`, {
//             headers: {
//               "x-request-id": requestId,
//               "x-country": req.dbInfo.country,
//               "x-resource": req.dbInfo.resource,
//             },
//           }),
//           axios.get(`http://localhost:3003/leaves/${user_id}/history`, {
//             headers: {
//               "x-request-id": requestId,
//               "x-country": req.dbInfo.country,
//               "x-resource": req.dbInfo.resource,
//             },
//           }),
//         ]);

//       const dashboard = {
//         requestId,
//         user: userResponse.data,
//         attendance: attendanceResponse.data,
//         leaves: leavesResponse.data,
//       };

//       // Cache the response
//       try {
//         await redis.set(cacheKey, JSON.stringify(dashboard), "EX", 600); // 10 minutes cache
//       } catch (cacheError) {
//         console.warn(`[GATEWAY] Cache save failed:`, cacheError.message);
//       }

//       res.status(200).json(dashboard);
//     } catch (error) {
//       console.error(`[GATEWAY] Dashboard error:`, error.message);
//       res.status(500).json({
//         error: error.message,
//       });
//     }
//   });

//   // Statistics endpoint
//   app.get("/stats", async (req, res) => {
//     try {
//       const poolStats = await axios
//         .get("http://localhost:3004/stats")
//         .catch(() => ({ data: { error: "Pool service unavailable" } }));

//       const stats = {
//         timestamp: new Date().toISOString(),
//         connectionPool: poolStats.data,

//         // Performance indicators
//         performance: {
//           totalConnections: poolStats.data.global?.totalConnections || 0,
//           activeConnections: poolStats.data.global?.activeConnections || 0,
//           connectionReuseRate:
//             poolStats.data.global?.connectionReuses &&
//             poolStats.data.global?.totalConnections
//               ? `${(
//                   (poolStats.data.global.connectionReuses /
//                     poolStats.data.global.totalConnections) *
//                   100
//                 ).toFixed(1)}%`
//               : "N/A",
//           poolUtilization: poolStats.data.global?.totalConnections
//             ? `${Math.min(
//                 100,
//                 (poolStats.data.global.activeConnections /
//                   poolStats.data.global.totalConnections) *
//                   100
//               ).toFixed(1)}%`
//             : "0%",
//         },
//       };

//       res.json(stats);
//     } catch (error) {
//       res.status(500).json({
//         error: "Failed to fetch stats",
//       });
//     }
//   });

//   app.listen(3000);
// }

import { PrismaClient } from "@prisma/client";
import express from "express";
const app = express();

app.get("/", async (req, res) => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.INDIA_CUSTOMER_READ4_DB_URI } },
    log: ["info"],
  });

  const users = await prisma.user.findUnique({
    where: {
      user_id: 123,
    },
  });

  res.status(200).json(users);
});

app.listen(9000);
