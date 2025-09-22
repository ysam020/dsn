/*
  Warnings:

  - You are about to drop the column `month` on the `attendance` table. All the data in the column will be lost.
  - You are about to drop the column `month` on the `leaves` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `users` table. All the data in the column will be lost.
  - Added the required column `attendance_month` to the `attendance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `attendance_month` to the `leaves` table without a default value. This is not possible if the table is not empty.
  - Added the required column `full_name` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."attendance_user_id_month_idx";

-- DropIndex
DROP INDEX "public"."leaves_user_id_month_idx";

-- AlterTable
ALTER TABLE "public"."attendance" DROP COLUMN "month",
ADD COLUMN     "attendance_month" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."leaves" DROP COLUMN "month",
ADD COLUMN     "attendance_month" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "name",
ADD COLUMN     "full_name" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "attendance_user_id_attendance_month_idx" ON "public"."attendance"("user_id", "attendance_month");

-- CreateIndex
CREATE INDEX "leaves_user_id_attendance_month_idx" ON "public"."leaves"("user_id", "attendance_month");
