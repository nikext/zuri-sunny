import { sqliteTable, text, real, integer, index } from 'drizzle-orm/sqlite-core'

export const pois = sqliteTable(
  'pois',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    amenity: text('amenity').notNull(),
    cuisine: text('cuisine'),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    openingHours: text('opening_hours'),
    tags: text('tags', { mode: 'json' }).$type<Record<string, string>>(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [index('pois_lat_lon_idx').on(t.lat, t.lon)],
)

export const buildings = sqliteTable(
  'buildings',
  {
    id: text('id').primaryKey(),
    footprint: text('footprint', { mode: 'json' }).notNull().$type<[number, number][]>(),
    heightM: real('height_m').notNull(),
    minLat: real('min_lat').notNull(),
    maxLat: real('max_lat').notNull(),
    minLon: real('min_lon').notNull(),
    maxLon: real('max_lon').notNull(),
  },
  (t) => [index('buildings_bbox_idx').on(t.minLat, t.maxLat, t.minLon, t.maxLon)],
)

export const cacheMeta = sqliteTable('cache_meta', {
  key: text('key').primaryKey(),
  refreshedAt: integer('refreshed_at').notNull(),
})

export type Poi = typeof pois.$inferSelect
export type NewPoi = typeof pois.$inferInsert
export type Building = typeof buildings.$inferSelect
export type NewBuilding = typeof buildings.$inferInsert
