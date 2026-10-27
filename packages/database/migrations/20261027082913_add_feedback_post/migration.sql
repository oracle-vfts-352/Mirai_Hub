-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "postId" UUID;

-- CreateIndex
CREATE INDEX "Feedback_postId_idx" ON "Feedback"("postId");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
