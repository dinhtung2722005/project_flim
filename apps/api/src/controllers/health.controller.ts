import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Database } from "../../../../packages/database/src/database";
import { Public } from "../common";
@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(private readonly db: Database) {}
  @Public()
  @Get()
  async health() {
    await this.db.$queryRawUnsafe("SELECT 1");
    return { status: "ok", database: "up" };
  }
}
