-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "effectiveMonth" TEXT,
ADD COLUMN     "exportStatus" TEXT;

-- AlterTable
ALTER TABLE "LeaveRecord" ADD COLUMN     "sourceRecordId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "StaffImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL,
    "role" TEXT NOT NULL,
    "skills" TEXT[],

    CONSTRAINT "StaffImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffImportRecord_batchId_staffId_key" ON "StaffImportRecord"("batchId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_kind_contentSha256_key" ON "ImportBatch"("kind", "contentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRecord_batchId_sourceRecordId_key" ON "LeaveRecord"("batchId", "sourceRecordId");

-- AddForeignKey
ALTER TABLE "StaffImportRecord" ADD CONSTRAINT "StaffImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
