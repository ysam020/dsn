import { PrismaClient } from "@prisma/client";
import { readReplicas } from "@prisma/extension-read-replicas";
import dotenv from "dotenv";

dotenv.config();

// Create Prisma client with read replicas extension
const prismaClient = new PrismaClient({
  datasources: {
    db: {
      url: process.env.INDIA_CUSTOMER_WRITE_DB_URI, // Primary database for writes
    },
  },
}).$extends(
  readReplicas({
    url: [
      process.env.INDIA_CUSTOMER_READ1_DB_URI,
      process.env.INDIA_CUSTOMER_READ2_DB_URI,
      process.env.INDIA_CUSTOMER_READ3_DB_URI,
      process.env.INDIA_CUSTOMER_READ4_DB_URI,
    ].filter(Boolean), // Filter out any undefined URLs
  })
);

export const prisma = prismaClient;

// Graceful shutdown
const disconnect = async () => {
  await prismaClient.$disconnect();
};

process.on("SIGTERM", async () => {
  await disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await disconnect();
  process.exit(0);
});

export { disconnect };

export default prismaClient;
