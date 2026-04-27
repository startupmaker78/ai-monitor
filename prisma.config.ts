import * as dotenv from "dotenv";
import * as os from "os";
import * as path from "path";
import { defineConfig } from "prisma/config";

dotenv.config({ path: ".env.local" });

// Prisma требует абсолютный путь к CA-сертификату (~ не работает в URL).
// Добавляем sslrootcert программно, чтобы не хранить абсолютный путь в .env.local.
const certPath = path.join(os.homedir(), ".postgresql", "root.crt");
const dbUrl = new URL(process.env.DATABASE_URL!);
dbUrl.searchParams.delete("sslmode");
dbUrl.searchParams.set("sslmode", "verify-full");
dbUrl.searchParams.set("sslrootcert", certPath);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: dbUrl.toString(),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
