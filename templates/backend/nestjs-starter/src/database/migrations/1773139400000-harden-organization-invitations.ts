import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenOrganizationInvitations1773139400000 implements MigrationInterface {
  name = 'HardenOrganizationInvitations1773139400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('UPDATE "invitations" SET "email" = LOWER(TRIM("email"))');
    await queryRunner.query(`
      DELETE FROM "invitations" invitation
      USING (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "organization_id", "email"
          ORDER BY "created_at" DESC, "id" DESC
        ) AS row_number
        FROM "invitations"
        WHERE "accepted_at" IS NULL
      ) duplicates
      WHERE invitation."id" = duplicates."id" AND duplicates.row_number > 1
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_invitations_active_org_email" ON "invitations" ("organization_id", "email") WHERE "accepted_at" IS NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "UQ_invitations_active_org_email"');
  }
}
