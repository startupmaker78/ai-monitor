-- AlterTable
ALTER TABLE "OwnerProfile" DROP COLUMN "metrikaCounterId",
DROP COLUMN "metrikaToken",
DROP COLUMN "siteUrl",
DROP COLUMN "tildaSiteId";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "analysisTargetId" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "metrikaCounterId" TEXT,
ADD COLUMN     "metrikaToken" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "sessionsAllocated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sessionsLimit" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Session_analysisTargetId_idx" ON "Session"("analysisTargetId");
