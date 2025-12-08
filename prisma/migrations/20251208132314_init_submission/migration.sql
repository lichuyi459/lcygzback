-- CreateEnum
CREATE TYPE "Category" AS ENUM ('PROGRAMMING', 'AIGC');

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "classNumber" INTEGER NOT NULL,
    "category" "Category" NOT NULL,
    "workTitle" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);
