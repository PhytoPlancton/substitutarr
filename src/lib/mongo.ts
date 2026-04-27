import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "substitutarr";

if (!uri) throw new Error("MONGODB_URI is not set");

type Cached = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalForMongo = global as unknown as { mongoose?: Cached };
const cached: Cached = globalForMongo.mongoose ?? { conn: null, promise: null };
globalForMongo.mongoose = cached;

export async function connectMongo(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri!, { dbName, bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
