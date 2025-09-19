import express from "express";
import cors from "cors";
import { dbWrapper } from "./dbWrapper.mjs";

const app = express();
app.use(cors());
app.use(express.json());

class LeavesService {
  async getLeaves(requestId, user_id, month) {
    try {
      // Get shared connection
      const db = await dbWrapper.getConnection(
        requestId,
        "india",
        "customer",
        "read"
      );

      const result = await db.query(
        "SELECT * FROM leaves WHERE user_id = $1 AND month = $2 ORDER BY start_date ASC",
        [parseInt(user_id), month]
      );
      const leaves = result.rows;

      return {
        user_id: parseInt(user_id),
        month,
        leaves,
        totalLeaves: leaves.length,
        connectionId: db.connectionId,
        replicaId: db.replicaId,
        usageCount: db.usageCount,
        isSharedConnection: db.isReused,
        executedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[LEAVES] Error fetching leaves:`, error.message);
      throw error;
    }
  }
}

const leavesService = new LeavesService();

// Middleware to set up request context
const setupRequestContext = (req, res, next) => {
  const requestId =
    req.headers["x-request-id"] ||
    `req_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
  const country = req.headers["x-country"] || "india";
  const resource = req.headers["x-resource"] || "customer";

  req.dbInfo = { requestId, country, resource };
  req.headers["x-request-id"] = requestId;

  next();
};

app.use(setupRequestContext);

app.get("/leaves/:user_id/:month", async (req, res) => {
  const { user_id, month } = req.params;
  const { requestId } = req.dbInfo;

  try {
    const leaves = await leavesService.getLeaves(requestId, user_id, month);
    res.json(leaves);
  } catch (error) {
    console.error(`[LEAVES] Error:`, error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(3003);
