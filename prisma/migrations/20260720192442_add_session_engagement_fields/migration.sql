-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "interactionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hasFullSnapshot" BOOLEAN NOT NULL DEFAULT false;
