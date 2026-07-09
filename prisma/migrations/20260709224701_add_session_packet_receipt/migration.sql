-- CreateTable
CREATE TABLE "SessionPacketReceipt" (
    "sessionToken" TEXT NOT NULL,
    "packetIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionPacketReceipt_pkey" PRIMARY KEY ("sessionToken","packetIndex")
);

-- CreateIndex
CREATE INDEX "SessionPacketReceipt_sessionToken_idx" ON "SessionPacketReceipt"("sessionToken");

-- AddForeignKey
ALTER TABLE "SessionPacketReceipt" ADD CONSTRAINT "SessionPacketReceipt_sessionToken_fkey" FOREIGN KEY ("sessionToken") REFERENCES "Session"("sessionToken") ON DELETE CASCADE ON UPDATE CASCADE;
