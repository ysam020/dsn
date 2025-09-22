import express from "express";
import cors from "cors";
import { prisma } from "./prismaService.mjs";

const app = express();
app.use(cors());
app.use(express.json());

class AttendanceService {
  async getAttendance(user_id, month) {
    try {
      const records = await prisma.attendance.findMany({
        where: {
          user_id: parseInt(user_id),
          month: month,
        },
        orderBy: { date: "asc" },
      });

      return {
        user_id: parseInt(user_id),
        month,
        records,
        totalRecords: records.length,
      };
    } catch (error) {
      console.error(`[ATTENDANCE] Error fetching attendance:`, error.message);
      throw error;
    }
  }
}

const attendanceService = new AttendanceService();

app.get("/attendance/:user_id/:month", async (req, res) => {
  const { user_id, month } = req.params;

  try {
    const attendance = await attendanceService.getAttendance(user_id, month);
    res.json(attendance);
  } catch (error) {
    console.error(`[ATTENDANCE] Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3002);
