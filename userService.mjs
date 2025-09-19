import express from "express";
import cors from "cors";
import { dbWrapper } from "./dbWrapper.mjs";

const app = express();
app.use(cors());
app.use(express.json());

class UserService {
  async getUser(requestId, user_id) {
    try {
      // Get shared connection
      const db = await dbWrapper.getConnection(
        requestId,
        "india",
        "customer",
        "read"
      );
      console.log(
        `[USER] Fetching user ${user_id} using connection ${db.connectionId}`
      );

      // Service handles its own query using the shared connection
      const result = await db.query(
        `SELECT * FROM users WHERE user_id = $1 LIMIT 1`,
        [parseInt(user_id)]
      );
      const user = result.rows[0];
      if (!user) {
        throw new Error(`User ${user_id} not found`);
      }

      return {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        department: user.department,
        status: user.status,
        connectionId: db.connectionId,
        replicaId: db.replicaId,
        usageCount: db.usageCount,
        executedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[USER] Error fetching user ${user_id}:`, error.message);
      throw error;
    }
  }
}

const userService = new UserService();

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

app.get("/user/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const { requestId } = req.dbInfo;

  try {
    const user = await userService.getUser(requestId, user_id);
    res.json(user);
  } catch (error) {
    console.error(`[USER] Error:`, error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(3001);
