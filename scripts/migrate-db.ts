import { closeDatabase, ensureDatabase } from "@/infra/db/client";

ensureDatabase();
closeDatabase();
console.log("RigMate database is ready.");
