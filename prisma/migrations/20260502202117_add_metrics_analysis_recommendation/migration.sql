-- CreateEnum
CREATE TYPE "MetricsSource" AS ENUM ('METRIKA', 'MANUAL');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('CRITICAL', 'IMPORTANT', 'GOOD');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'REJECTED');

-- CreateTable
CREATE TABLE "MetricsSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visits" INTEGER NOT NULL,
    "uniqueVisitors" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "bounceRate" DECIMAL(5,2) NOT NULL,
    "avgSessionDuration" INTEGER NOT NULL,
    "goals" JSONB,
    "source" "MetricsSource" NOT NULL DEFAULT 'METRIKA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT,
    "sessionsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "recommendationsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "priority" "RecommendationPriority" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'NEW',
    "sortOrder" INTEGER NOT NULL,
    "rejectionReason" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "metricsBefore" JSONB,
    "metricsAfter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricsSnapshot_siteId_date_key" ON "MetricsSnapshot"("siteId", "date");

-- CreateIndex
CREATE INDEX "Analysis_siteId_createdAt_idx" ON "Analysis"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Analysis_targetId_createdAt_idx" ON "Analysis"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_analysisId_sortOrder_idx" ON "Recommendation"("analysisId", "sortOrder");

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");

-- AddForeignKey
ALTER TABLE "MetricsSnapshot" ADD CONSTRAINT "MetricsSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AnalysisTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
