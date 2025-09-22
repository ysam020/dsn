import { PrismaClient } from "@prisma/client";
import { readReplicas } from "@prisma/extension-read-replicas";
import dotenv from "dotenv";

dotenv.config();

// Create Prisma client with read replicas extension
const prismaClient = new PrismaClient({
  datasources: {
    db: {
      url: process.env.INDIA_CUSTOMER_WRITE_DB_URI, // Primary database
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

export default prismaClient;
