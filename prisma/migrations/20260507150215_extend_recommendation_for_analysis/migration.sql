/*
  Warnings:

  - Added the required column `category` to the `Recommendation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `effort` to the `Recommendation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `evidence` to the `Recommendation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expectedImpact` to the `Recommendation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `problem` to the `Recommendation` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RecommendationCategory" AS ENUM ('USABILITY', 'CONTENT', 'MOBILE', 'PERFORMANCE', 'TRUST');

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "category" "RecommendationCategory" NOT NULL,
ADD COLUMN     "effort" TEXT NOT NULL,
ADD COLUMN     "evidence" TEXT NOT NULL,
ADD COLUMN     "expectedImpact" TEXT NOT NULL,
ADD COLUMN     "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "problem" TEXT NOT NULL;
