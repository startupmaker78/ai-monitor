-- CreateEnum
CREATE TYPE "AnalysisTargetStatus" AS ENUM ('ACTIVE', 'READY', 'ANALYZING', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "AnalysisTarget" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "sessionsBudget" INTEGER NOT NULL,
    "sessionsCollected" INTEGER NOT NULL DEFAULT 0,
    "status" "AnalysisTargetStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisTarget_siteId_status_idx" ON "AnalysisTarget"("siteId", "status");

-- CreateIndex
CREATE INDEX "AnalysisTarget_archivedAt_idx" ON "AnalysisTarget"("archivedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_analysisTargetId_fkey" FOREIGN KEY ("analysisTargetId") REFERENCES "AnalysisTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisTarget" ADD CONSTRAINT "AnalysisTarget_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
