ALTER TABLE `shift_requests` ADD `shift_times` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `client_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_shifts_client_request` ON `shifts` (`created_by`,`client_request_id`) WHERE "shifts"."client_request_id" IS NOT NULL;--> statement-breakpoint
-- A customer enrolled more than once by a once-per-customer trigger keeps the
-- oldest run (its step history goes with the removed runs).
DELETE FROM `journey_runs`
WHERE `trigger_event` IN ('phone_verified', 'profile_completed')
	AND `rowid` NOT IN (
		SELECT `rowid` FROM (
			SELECT
				`rowid`,
				ROW_NUMBER() OVER (
					PARTITION BY `journey_id`, `customer_id`, `trigger_event`
					ORDER BY COALESCE(`created_at`, 0), `rowid`
				) AS `rn`
			FROM `journey_runs`
			WHERE `trigger_event` IN ('phone_verified', 'profile_completed')
		) AS `ranked`
		WHERE `rn` = 1
	);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_journey_runs_once_per_customer` ON `journey_runs` (`journey_id`,`customer_id`,`trigger_event`) WHERE "journey_runs"."trigger_event" IN ('phone_verified', 'profile_completed');--> statement-breakpoint
-- Two dispatchers that both wrote a row for a broadcast recipient: keep the
-- oldest row.
DELETE FROM `marketing_messages`
WHERE `campaign_id` IS NOT NULL
	AND `rowid` NOT IN (
		SELECT `rowid` FROM (
			SELECT
				`rowid`,
				ROW_NUMBER() OVER (
					PARTITION BY `campaign_id`, `customer_id`
					ORDER BY COALESCE(`sent_at`, 0), `rowid`
				) AS `rn`
			FROM `marketing_messages`
			WHERE `campaign_id` IS NOT NULL
		) AS `ranked`
		WHERE `rn` = 1
	);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_marketing_messages_campaign_customer` ON `marketing_messages` (`campaign_id`,`customer_id`) WHERE "marketing_messages"."campaign_id" IS NOT NULL;
