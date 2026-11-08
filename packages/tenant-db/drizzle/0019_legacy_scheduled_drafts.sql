-- Before broadcasts had a dispatcher, a scheduled broadcast was saved as
-- `Draft` with `scheduled_at` set, and nothing ever sent it. The dispatcher
-- claims only `Scheduled` rows. A legacy draft whose time is still ahead
-- becomes `Scheduled`, so it goes out as the operator planned. One whose time
-- has passed is marked `Failed`, so an old campaign never goes out late.
-- `scheduled_at` is stored in whole seconds.
UPDATE `marketing_campaigns`
SET `status` = 'Scheduled'
WHERE `status` = 'Draft'
	AND `scheduled_at` IS NOT NULL
	AND `scheduled_at` > CAST(strftime('%s', 'now') AS INTEGER);--> statement-breakpoint
UPDATE `marketing_campaigns`
SET `status` = 'Failed'
WHERE `status` = 'Draft'
	AND `scheduled_at` IS NOT NULL
	AND `scheduled_at` <= CAST(strftime('%s', 'now') AS INTEGER);
