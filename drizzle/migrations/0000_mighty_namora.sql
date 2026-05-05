CREATE TABLE `buildings` (
	`id` text PRIMARY KEY NOT NULL,
	`footprint` text NOT NULL,
	`height_m` real NOT NULL,
	`min_lat` real NOT NULL,
	`max_lat` real NOT NULL,
	`min_lon` real NOT NULL,
	`max_lon` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `buildings_bbox_idx` ON `buildings` (`min_lat`,`max_lat`,`min_lon`,`max_lon`);--> statement-breakpoint
CREATE TABLE `cache_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`refreshed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pois` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`amenity` text NOT NULL,
	`cuisine` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`opening_hours` text,
	`tags` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pois_lat_lon_idx` ON `pois` (`lat`,`lon`);