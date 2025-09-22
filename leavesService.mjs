import express from "express";
import cors from "cors";
import { prisma } from "./prismaService.mjs";

const app = express();
app.use(cors());
app.use(express.json());

class LeavesService {
  async getLeaveHistory(user_id) {
    try {
      const leaveRecords = await prisma.leave.findMany({
        where: {
          user_id: parseInt(user_id),
        },
        orderBy: { start_date: "desc" },
      });

      return {
        user_id: parseInt(user_id),
        records: leaveRecords,
        totalLeaves: leaveRecords.length,
      };
    } catch (error) {
      console.error(`[LEAVES] Error fetching leave history:`, error.message);
      throw error;
    }
  }
}

const leavesService = new LeavesService();

// Get complete leave history
app.get("/leaves/:user_id/history", async (req, res) => {
  const { user_id } = req.params;

  try {
    const leaves = await leavesService.getLeaveHistory(user_id);
    res.json(leaves);
  } catch (error) {
    console.error(`[LEAVES] Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3003);
