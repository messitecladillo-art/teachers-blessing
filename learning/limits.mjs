/** Shared local service budgets. Public upload limits are also returned by /config/public. */
export const LEARNING_LIMITS=Object.freeze({
  textbookBytes:300*1024**2,pages:3000,workshopBytes:30*1024**2,markdownBytes:5*1024**2,
  workshopFiles:10,imageMaxEdge:4096,imagePixels:12000000,textChars:4000000,
  sourceChars:24000,structurePages:20,ocrPages:5,dailyUnits:100,concurrentPerUser:2,totalStorage:1024**3,
  importModelCalls:100,importMaxModelCalls:200,importOcrPages:3000,importChapterKnowledgePoints:200,
  importParentsPerUser:2,importParentsGlobal:8,
});
