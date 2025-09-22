import express from "express";
import cors from "cors";
import axios from "axios";
import { redis } from "./redis.mjs";
import cluster from "cluster";
import os from "os";

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Dashboard endpoint - combines data from microservices
  app.get("/user/:user_id/dashboard/:month", async (req, res) => {
    const { user_id, month } = req.params;

    try {
      const cacheKey = `dashboard:${user_id}:${month}`;
      const cachedData = await redis.get(cacheKey).catch(() => null);

      if (cachedData && Math.random() < 0.8) {
        return res.json(JSON.parse(cachedData));
      }

      const startTime = Date.now();

      // Call microservices in parallel
      const [userResponse, attendanceResponse, leavesResponse] =
        await Promise.all([
          axios.get(`http://localhost:3001/user/${user_id}`),
          axios.get(`http://localhost:3002/attendance/${user_id}/${month}`),
          axios.get(`http://localhost:3003/leaves/${user_id}/history`),
        ]);

      const dashboard = {
        user: userResponse.data,
        attendance: attendanceResponse.data,
        leaves: leavesResponse.data,
      };

      // Cache the response
      try {
        await redis.set(cacheKey, JSON.stringify(dashboard), "EX", 600);
      } catch (cacheError) {
        console.warn(`[GATEWAY] Cache save failed:`, cacheError.message);
      }

      res.json(dashboard);
    } catch (error) {
      console.error(`[GATEWAY] Dashboard error:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy endpoints for individual services
  app.get("/user/:user_id", async (req, res) => {
    try {
      const response = await axios.get(
        `http://localhost:3001/user/${req.params.user_id}`
      );
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/attendance/:user_id/:month", async (req, res) => {
    try {
      const response = await axios.get(
        `http://localhost:3002/attendance/${req.params.user_id}/${req.params.month}`
      );
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/leaves/:user_id/history", async (req, res) => {
    try {
      const response = await axios.get(
        `http://localhost:3003/leaves/${req.params.user_id}/history`
      );
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.listen(3000);
}
