import mongoose from 'mongoose';
import dns from 'node:dns';

// Production-ready DNS resolver patch for MongoDB Atlas SRV/TXT lookups.
// Resolves MongoDB Atlas records via reliable public DNS (8.8.8.8, 1.1.1.1) when local/loopback
// DNS refuses SRV queries, with idempotency guards and scoped domain matching.
if (!global.__mongoDnsPatched) {
  try {
    const customResolver = new dns.promises.Resolver();
    customResolver.setServers(['8.8.8.8', '1.1.1.1']);

    const originalResolve = dns.promises.resolve.bind(dns.promises);

    const isMongoQuery = (hostname) =>
      typeof hostname === 'string' &&
      (hostname.endsWith('.mongodb.net') || hostname.startsWith('_mongodb.'));

    dns.promises.resolve = async function (hostname, rrtype) {
      const type = rrtype || 'A';

      // Only route MongoDB-related SRV/TXT queries to the public DNS resolver
      if ((type === 'SRV' || type === 'TXT') && isMongoQuery(hostname)) {
        try {
          return await customResolver.resolve(hostname, type);
        } catch (resolverError) {
          // Safe diagnostic logging without exposing credentials or full URIs
          console.warn('[MongoDB DNS Resolver] Public DNS query failed:', {
            recordType: type,
            code: resolverError?.code || null,
            syscall: resolverError?.syscall || null,
          });
          return await originalResolve(hostname, type);
        }
      }

      return await originalResolve(hostname, type);
    };

    global.__mongoDnsPatched = true;
  } catch (error) {
    console.warn('[MongoDB DNS Resolver] Could not initialize custom resolver:', error?.code || error?.message);
  }
}

/**
 * Global cache across hot reloads in Next.js development mode.
 * Prevents multiple connections during API Route executions.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * Connects to MongoDB using Mongoose with connection pooling and caching.
 * @returns {Promise<typeof mongoose>}
 */
async function connectToDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri || uri.trim() === '') {
    const error = new Error('MONGODB_URI environment variable is not defined or is empty.');
    error.code = 'DB_CONFIG_MISSING';
    throw error;
  }

  // Reuse existing active connection if readyState is 1 (connected)
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds instead of hanging
    };

    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Reset cache on failure so subsequent requests can attempt reconnection
    cached.promise = null;
    cached.conn = null;

    // Safe sanitized diagnostic logging without credentials or secrets
    const sanitizedMsg = (error?.message || '')
      .replace(/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, 'mongodb+srv://[REDACTED]')
      .replace(/:([^@\s/:?]+)@/g, ':[REDACTED]@');
    console.error(`[MongoDB Connection Error] ${error?.name || 'Error'}: ${sanitizedMsg}`);

    throw error;
  }

  return cached.conn;
}

export default connectToDatabase;
