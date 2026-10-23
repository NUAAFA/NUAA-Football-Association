CREATE TABLE "ResourceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "builtinKey" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "dateLabel" TEXT NOT NULL DEFAULT '',
    "versionStatus" TEXT NOT NULL DEFAULT 'historical',
    "versionNote" TEXT NOT NULL DEFAULT '',
    "playingFormat" TEXT NOT NULL DEFAULT 'all',
    "trainingLevel" TEXT NOT NULL DEFAULT '基础',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "mediaAssetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResourceDocument_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResourceDocument_builtinKey_key" ON "ResourceDocument"("builtinKey");
CREATE INDEX "ResourceDocument_status_category_sortOrder_idx" ON "ResourceDocument"("status", "category", "sortOrder");
CREATE INDEX "ResourceDocument_mediaAssetId_idx" ON "ResourceDocument"("mediaAssetId");
