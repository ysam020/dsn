import express from "express";
import cors from "cors";
import { prisma } from "./prismaService.mjs";

const app = express();
app.use(cors());
app.use(express.json());

class UserService {
  async getUser(user_id) {
    try {
      const user = await prisma.user.findUnique({
        where: { user_id: parseInt(user_id) },
      });

      if (!user) {
        throw new Error(`User ${user_id} not found`);
      }

      return {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        department: user.department,
        status: user.status,
      };
    } catch (error) {
      console.error(`[USER] Error fetching user ${user_id}:`, error.message);
      throw error;
    }
  }
}

const userService = new UserService();

app.get("/user/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const user = await userService.getUser(user_id);
    res.json(user);
  } catch (error) {
    console.error(`[USER] Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001);
