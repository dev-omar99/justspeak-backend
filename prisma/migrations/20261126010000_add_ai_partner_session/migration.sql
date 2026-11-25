-- CreateTable
CREATE TABLE "AiPartnerSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "fieldId" TEXT,
    "lessonId" TEXT,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "facts" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB,
    "reportModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPartnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPartnerSession_userId_createdAt_idx" ON "AiPartnerSession"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiPartnerSession" ADD CONSTRAINT "AiPartnerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
