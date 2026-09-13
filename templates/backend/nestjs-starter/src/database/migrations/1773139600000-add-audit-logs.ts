import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogs1773139600000 implements MigrationInterface {
  name = 'AddAuditLogs1773139600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "audit_logs" (
      "id" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "actor_user_id" uuid,
      "action" character varying(80) NOT NULL,
      "target_type" character varying(40) NOT NULL,
      "target_id" character varying(255),
      "metadata" text NOT NULL DEFAULT '{}',
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
      CONSTRAINT "FK_audit_logs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_audit_logs_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query('CREATE INDEX "IDX_audit_logs_actor_user_id" ON "audit_logs" ("actor_user_id")');
    await queryRunner.query('CREATE INDEX "IX_audit_logs_org_created_id" ON "audit_logs" ("organization_id", "created_at", "id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IX_audit_logs_org_created_id"');
    await queryRunner.query('DROP INDEX "IDX_audit_logs_actor_user_id"');
    await queryRunner.query('DROP TABLE "audit_logs"');
  }
}
