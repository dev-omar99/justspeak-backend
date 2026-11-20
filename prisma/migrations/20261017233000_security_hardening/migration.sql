-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "participantIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- Safe Backfill 1: Only mark existing users as emailVerified if a verified OtpCode record created on or after the user account creation exists for their email
UPDATE "User" u
SET "emailVerified" = true
WHERE u."email" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "OtpCode" o
    WHERE LOWER(o."identifier") = LOWER(u."email")
      AND o."verified" = true
      AND o."createdAt" >= u."createdAt"
  );

-- Safe Backfill 2: Populate participantIds for existing sessions that already have recorded SessionFeedback
UPDATE "Session" s
SET "participantIds" = ARRAY(
  SELECT DISTINCT uid
  FROM (
    SELECT f."giverId" AS uid FROM "SessionFeedback" f WHERE f."sessionId" = s."id"
    UNION
    SELECT f."receiverId" AS uid FROM "SessionFeedback" f WHERE f."sessionId" = s."id"
  ) AS participants
)
WHERE EXISTS (
  SELECT 1 FROM "SessionFeedback" f WHERE f."sessionId" = s."id"
);
