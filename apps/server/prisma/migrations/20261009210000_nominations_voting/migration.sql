-- AlterTable
ALTER TABLE "Housemate" ADD COLUMN "perks" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "Nomination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "nominatorId" TEXT NOT NULL,
    "nomineeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Nomination_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoteWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "opensAt" DATETIME NOT NULL,
    "closesAt" DATETIME NOT NULL,
    "nomineeIds" TEXT NOT NULL,
    "revealedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoteWindow_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voteWindowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nomineeId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vote_voteWindowId_fkey" FOREIGN KEY ("voteWindowId") REFERENCES "VoteWindow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Nomination_seasonId_round_idx" ON "Nomination"("seasonId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Nomination_seasonId_round_nominatorId_nomineeId_key" ON "Nomination"("seasonId", "round", "nominatorId", "nomineeId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteWindow_seasonId_round_key" ON "VoteWindow"("seasonId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_voteWindowId_userId_key" ON "Vote"("voteWindowId", "userId");
