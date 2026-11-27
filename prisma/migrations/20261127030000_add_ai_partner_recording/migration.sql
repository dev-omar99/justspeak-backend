-- CreateTable
CREATE TABLE "AiPartnerRecording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPartnerRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPartnerRecording_sessionId_position_idx" ON "AiPartnerRecording"("sessionId", "position");

-- CreateIndex
CREATE INDEX "AiPartnerRecording_userId_createdAt_idx" ON "AiPartnerRecording"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiPartnerRecording" ADD CONSTRAINT "AiPartnerRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiPartnerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
