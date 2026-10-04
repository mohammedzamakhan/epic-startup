ALTER TABLE `OrganizationChatChannel` ADD `kind` text DEFAULT 'channel' NOT NULL;--> statement-breakpoint
ALTER TABLE `OrganizationChatChannel` ADD `dmPairKey` text;--> statement-breakpoint
ALTER TABLE `OrganizationChatChannel` ADD `showHistoryToNewMembers` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `OrganizationChatChannel_organizationId_dmPairKey_key` ON `OrganizationChatChannel` (`organizationId`,`dmPairKey`);--> statement-breakpoint
ALTER TABLE `OrganizationChatChannelMember` ADD `joinedAt` integer;--> statement-breakpoint
UPDATE `OrganizationChatChannelMember` SET `joinedAt` = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE `joinedAt` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO "Permission" ("id", "action", "entity", "access", "context", "description", "createdAt", "updatedAt") VALUES
	('org_perm_create_chat_group', 'create', 'chat', 'group', 'organization', 'Create group chats and add members', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT OR IGNORE INTO "_OrganizationPermissionToRole" ("A", "B") VALUES
	('org_role_admin', 'org_perm_create_chat_group');