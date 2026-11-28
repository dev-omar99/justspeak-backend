-- CreateTable
CREATE TABLE "AiFreeTurnUsage" (
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiFreeTurnUsage_pkey" PRIMARY KEY ("userId","dateKey")
);

-- AddForeignKey
ALTER TABLE "AiFreeTurnUsage" ADD CONSTRAINT "AiFreeTurnUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

